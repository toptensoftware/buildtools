"use strict";

let child_process = require('child_process');
let os = require('os');
let fs = require('fs');
let path = require('path');


function processCommandLine(argv)
{
	var cl = {
		switches: {},
		files: [],
	}

	for (var i=2; i<argv.length; i++)
	{
		var a = argv[i];

		var isSwitch = false;
		if (a.startsWith("--"))
		{
			isSwitch = true;
			a = a.substring(2);
		}
		else if (a.startsWith("/"))
		{
			isSwitch = true;
			a = a.substring(1);
		}

		if (isSwitch)
		{
			var parts = a.split(':');
			if (parts.length == 2)
			{
				if (parts[1]=='false' || parts[1]=='no')
					cl.switches[parts[0]] = false;
				else
					cl.switches[parts[0]] = parts[1];
			}
			else
			{
				cl.switches[parts[0]] = true;
			}
		}
		else
		{
			cl.files.push(a);
		}
	}
	return cl;
}

// Process command line args
var commandLine = processCommandLine(process.argv);

// Simple helper to merge two or more objects
function merge(map1)
{
	for (var i=1; i<arguments.length; i++)
	{
		var map2 = arguments[i];
		for (var p in map2)
		{
			if (map2.hasOwnProperty(p))
				map1[p] = map2[p]
		}
	}
	return map1;
}

function escapeArg(x)  
{
    if (os.platform() == "win32")
        return (x.indexOf(' ') >= 0 || x.indexOf('|') >= 0)? `"${x}"` : x;
    else
        return x.replace(/ /g, '\\ ');
}


// Expand `string` using keys from `options`
function expand(str, options)
{
	// Replace $(variables)
	return str.replace(/\$\(.*?\)/g, function(x) {

		// Work out key name
		var key = x.substring(2, x.length - 1);

		// Recursively expand
		if (options.hasOwnProperty(key))
			return expand(options[key], options);

		throw new Error(`Unknown variable "${x}"" in "${str}", env = ${JSON.stringify(options)}`);
	});
}

// Make sure a variable is an array
function ensureArray(x)
{
	if (x.constructor === Array)
		return x
	else
		return [x];
}

// Get the filetime for a file, or return 0 if doesn't exist
function filetime(filename)
{
	try
	{
		return fs.statSync(filename).mtime.getTime();
	}
	catch (x)
	{
		return 0;
	}
}

// Check if a file is up to date with respect to a set of input files
function isUpToDate(outputFile, inputFiles, opts)
{
	if (opts && opts.force)
	{
		if (opts && opts.debug)
			console.log(`Forcing update of target file ${outputFile}...`);
		return false;
	}
	
	// Get the target file time
	var targetTime = filetime(outputFile);
	if (targetTime == 0)
	{
		if (opts && opts.debug)
			console.log(`Target file ${outputFile} doesn't exist, needs update...`);

		return false;
	}

	// Any input files?
	if (!inputFiles || inputFiles.length == 0)
		return false;

	// Check each
	for (var f of inputFiles)
	{
		if (filetime(f) > targetTime)
		{
			if (opts && opts.debug)
				console.log(`Target file '${outputFile}' is stale compared to '${f}', needs update...`)
			return false;
		}
	}

	if (opts && opts.debug)
	{
		console.log(`Target file '${outputFile}' is update to date with respect to:`);
		for (var f of inputFiles)
		{
			console.log(`    ${f}`);
		}
	}


	return true;
}

function fixSlashes(str)
{
	if (os.platform() != "win32")
		return str;

	return str.replace(/\//g, '\\');

}

// Ensure a folder exists
function mkdir(folder, opts)
{
	if (fs.existsSync(folder))
		return;

	if (opts && opts.verbose)
	{
		console.log(`Creating ${folder}...`);
	}

	if (os.platform() != "win32")
		run(`@mkdir -p ${escapeArg(folder)}`, opts);
	else
		run(`@mkdir ${fixSlashes(escapeArg(folder))}`, opts);
}

// Run a command
function run(cmd, opts)
{
    var opts = merge({
    	stdio: 'inherit',
		shell: false,
    }, opts);

    // Silent?
    if (cmd.startsWith("@"))
    {
    	cmd = cmd.substring(1);

    	if (opts.verbose && !cmd.startsWith("echo "))
    	{
    		console.log(cmd);
    	}
    }
    else
    {
    	if (!cmd.startsWith("echo "))
    		console.log(cmd);
    }

    // Spawn process
    var r;
	if (os.platform() == "win32")
    	r = child_process.spawnSync(process.env.ComSpec, ["/C", cmd], opts);
    else
    	r = child_process.spawnSync("/bin/sh", ["-c", cmd], opts);

    // Failed to launch
    if (r.error)
    {
		console.log("\nFailed", r.error.message);
		process.exit(7);
    }

    // Failed exit code?
	if (r.status != 0)
	{
		console.log("\nFailed with exit code", r);
		process.exit(7);
	}
}

function parseDepsFile(filename, targetFile, opts)
{
	// Debug?
	if (opts && opts.debug)
	{
		console.log(`Parsing ${filename} to find dependencies for ${targetFile}`);
	}

	// Does the file exist?
	if (!fs.existsSync(filename))
	{
		if (opts && opts.debug)
			console.log(`  dependency file ${filename} doesn't exist`);
		return [];
	}

	// Read file
	var text = fs.readFileSync(filename, 'utf8');

	// Split into lines
	text = text.replace(/(\r\n|\r|\n)/g, '\n');
	var lines = text.split('\n');

	// Join lines
	for (var i=0; i<lines.length; i++)
	{
		if (lines[i].endsWith('\\'))
		{
			// Join with next line
			lines[i] = lines[i].substring(0, lines[i].length-1) + lines[i+1];

			// Remove the following line
			lines.splice(i+1, 1);

			// Reprocess this line
			i--;
		}
	}

	for (var l of lines)
	{
		var parts = l.split(' ').filter(x=>!!x);
		if (parts.length>1 && parts[0] == targetFile + ":")
		{
			var deps = parts.slice(1);
			return deps;
		}
		console.log(parts[0]);
	}

	console.log(`Warning: dependency file ${filename} doesn't specify dependencies for ${targetFile}`);
	return [];
}

function joinPathNoReduce(a, b)
{
	if (!a)
		return b;
	if (!b)
		return a;

	if (a.endsWith('/') || a.endsWith('\\'))
		a = a.substring(0, a.length-1);

	if (b.startsWith('/') || b.startsWith('\\'))
		b = a.substring(1);

	return a + path.sep + b;
}


class Runner
{
	constructor()
	{
		this.env = {};
		this.commandLine = commandLine;
		this.executedCommands = 0;
	}

	expand(str)
	{
		return expand(str, this.env);
	}

	runDep(cwd)
	{
		var runOpts = {
			verbose: !!this.commandLine.switches.verbose,
			debug: !!this.commandLine.switches.debug,
			force: !!this.commandLine.switches.force,
			cwd: cwd,
		}

		var switches = "";
		if (this.commandLine.switches.verbose)
			switches += " --verbose";
		if (this.commandLine.switches.debug)
			switches += " --debug";
		if (this.commandLine.switches.force)
			switches += " --force";
		if (this.commandLine.switches.clean)
			switches += " --clean";
		

		run(expand("@node makefile.js --config:$(CONFIG)" + switches, this.env), runOpts);
	}

	run(options)
	{
		var runOpts = {
			verbose: !!this.commandLine.switches.verbose,
			debug: !!this.commandLine.switches.debug,
			force: !!this.commandLine.switches.force,
		}

		if (this.runEnv)
		{
			runOpts.env = this.runEnv;
		}

		// Get inputFiles
		var inputFiles;
		if (options.inputFile && !options.inputFiles)
		{
			inputFiles = [options.inputFile];
			delete options.inputFile;
		}
		else if (options.inputFiles)
		{
			inputFiles = options.inputFiles;
			delete options.inputFiles;
		}

		// Apply input directory
		if (options.inputDir && inputFiles)
		{
			inputFiles = inputFiles.map(x=>joinPathNoReduce(options.inputDir, x));
		}

		// Make sure command is an array
		options.command = ensureArray(options.command);

		var outputFileList = [];

		function process(files)
		{
			// Setup the environment for this run
			var env = merge({}, this.env);

			// Setup input files			
			if (files)
			{
				// Expand input files
				files = files.map(x => this.expand(x));

				var env = merge({}, this.env, {
					INPUTFILE: files[0],
					INPUTFILES: files.join(" "),
					INPUTNAME: path.parse(files[0]).name,
					INPUTFILENAME: path.basename(files[0]),
				})

				// Work out the output file
				if (options.outputFile)
				{
					// Work out the output file
					var outputFile;
					if (typeof(options.outputFile) == 'function')
					{
						outputFile = options.outputFile(files[0]);
					}
					else
					{
						outputFile = options.outputFile;
					}
					outputFile = expand(outputFile, env);

					env.OUTPUTFILE = outputFile;
					env.OUTPUTNAME = path.parse(outputFile).name;
					env.OUTPUTFILENAME = path.basename(outputFile);

					// Add the output file to the list
					if (env.OUTPUTFILE)
						outputFileList.push(env.OUTPUTFILE);


					// Look for dependencies
					var dependencies = [];
					if (options.dependencies)
					{
						// Function or string?
						if (typeof(options.dependencies) == 'function')
						{
							dependencies = options.dependencies(files[0]);
						}
						else
						{
							dependencies = options.dependencies;
						}

						// If it's a string either split it, or if it's a .d file
						// parse it...
						if (typeof(dependencies) === 'string')
						{
							if (dependencies.endsWith('.d'))
							{
								dependencies = parseDepsFile(expand(dependencies, env), outputFile, runOpts);
							}
							else
							{
								dependencies = dependencies.split(' ');							
							}
						}

						// Make sure it's an array
						dependencies = ensureArray(dependencies);

						// Expand all
						dependencies = dependencies.map(x => expand(x, env));
					}

					if (isUpToDate(outputFile, files.concat(dependencies), runOpts))
					{
						return;
					}

					// Make sure the output folder exists
					mkdir(path.dirname(outputFile));
				}
			}

			// Setup file flags
			if (options.fileFlags)
			{
				var fileFlags;
				if (typeof(options.fileFlags) == 'function')
				{
					fileFlags = options.fileFlags(files[0]);
				}
				else
				{
					fileFlags = options.fileFlags;
				}
				env.FILEFLAGS = expand(fileFlags, env);
			}
			else
			{
				env.FILEFLAGS = "";	
			}

			// Execute commands
			for (var cmd of options.command)
			{
				run(expand(cmd, env), runOpts);
				this.executedCommands++;
			}
		}

		// Work out if this is a single or multiple exec
		if (options.command.some(x => x.indexOf("$(INPUTFILES)") !== -1) || !inputFiles)
		{
			process.bind(this)(inputFiles);
		}
		else
		{
			for (var inputFile of inputFiles)
			{
				process.bind(this)([inputFile]);
			}
		}

		return outputFileList;
	}

	setRunEnv(env)
	{
		this.runEnv = env;
	}

	resetRunEnv(env)
	{
		delete this.runEnv;
	}

	setVCRunEnv(platform)
	{
		if (platform == "x64")
			platform = "x86_amd64";

		var envFile = `${process.env.temp}\\env_${platform}.txt`;

		if (this.commandLine.switches.force || !fs.existsSync(envFile))
		{
			if (this.commandLine.switches.verbose)
				console.log(`Running vcvarsall for ${platform}`);

			// Create a batch file to capture the vs environment
			var batchScript = `@call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat" ${platform} > nul\n`;
			batchScript += `@set > ${envFile}`;

			// Save the batch file
			var batchFile = `${process.env.temp}\\captureenv.bat`;
			fs.writeFileSync(batchFile, batchScript, 'utf8');	

			// Run the batch file
			child_process.spawnSync(process.env.ComSpec, ["/C", batchFile], {
		    	stdio: 'inherit',
		    	shell: false,
		    });
		}
		else
		{
			if (this.commandLine.switches.verbose)
				console.log(`Re-using cached VC environment for ${platform}`);
		}

	    // Read the environemnt
	    var envText = fs.readFileSync(`${envFile}`, 'utf8').replace(/(\r\n|\r|\n)/g, '\n');

	    // Parse environment
		var lines = envText.split('\n');

		var env = {};
		for (var i=0; i<lines.length; i++)
		{
			var kv = lines[i].split('=');
			if (kv.length > 1)
			{
				env[kv[0]] = kv[1];
			}
		}

		// Setup environment
		this.setRunEnv(env);
	}

	initVisualStudio()
	{
		// Defaults
		this.env = {
			OS: "win",
			PLATFORM: this.commandLine.switches.platform || "x64",
			CONFIG: this.commandLine.switches.config || "release",
			CL: "cl",
			COMMONFLAGS: "/Zi /nologo /W3 /WX- /Gm- /D WIN32 /D _CRT_SECURE_NO_WARNINGS /D _UNICODE /D UNICODE /GS- /Gy- /fp:precise /Zc:wchar_t /Zc:forScope /GR- /Gd /analyze- /Fd$(INTDIR)\\$(PROJECTNAME).pdb",
			CFLAGS: "/TC",
			CPPFLAGS: "/TP",
			LIBFLAGS: "",
			INTDIR: "..\\obj\\$(OS)\\$(PLATFORM)\\$(CONFIG)",
			LIBFILE: "$(OUTDIR)\\$(PROJECTNAME).lib",
		};

		// Setup Platform
		if (this.env.PLATFORM == "x64")
		{
			this.env.COMMONFLAGS += " /D _WIN64";
		}
		else if (this.env.PLATFORM == "x86")
		{
			this.env.COMMONFLAGS += " /arch:SSE";
		}
		else
		{
			console.log(`unknown platform: "${this.env.PLATFORM}"`);
			process.exit(7);
		}

		// Set Configuration
		if (this.env.CONFIG == "debug")
		{
			this.env.COMMONFLAGS += " /D _DEBUG /MTd";
		}
		else if (this.env.CONFIG == "release")
		{
			this.env.COMMONFLAGS += " /D NDEBUG /O2 /Ob2 /Oi /Ot /Oy /GL /MT";
			this.env.LIBFLAGS += " /LTCG";
		}
		else
		{
			console.log(`unknown config: "${this.env.CONFIG}"`);
			process.exit(7);
		}

		// Setup Visual Studio run environment
		this.setVCRunEnv(this.env.PLATFORM);
	}
}


// 

module.exports = {
	merge: merge,
	mkdir: mkdir,
	expand: expand,
	run: run,
	instance: new Runner(),
	commandLine: commandLine,
}

