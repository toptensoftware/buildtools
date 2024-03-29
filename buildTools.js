var os = require('os');
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var options = 
{
	verbose: false,
	official: false,
	debug: false,
	files: [],
};

function clock_version()
{
	var verInfo = options.version;
	var newBuild = prompt(`Enter new build number, 'n' to keep current (${verInfo.build}), or enter to bump to ${verInfo.build+1}:`);
	if (newBuild != "n")
		verInfo.build = newBuild ? parseInt(newBuild) : verInfo.build + 1;
	fs.writeFileSync("version.json", JSON.stringify(verInfo, null, 4), 'UTF8');

	// Work out copyright year range
	var now = new Date();
	var currentYear = now.getUTCFullYear()
	var copyrightYear = currentYear == verInfo.copyrightYear ? "" + currentYear : verInfo.copyrightYear + "-" + currentYear;

	if (verInfo.generateCHeader)
	{
		// Write version .h
		fs.writeFileSync("version.h", `
#define VER_A		${verInfo.major}
#define VER_B		${verInfo.minor}
#define VER_C		${verInfo.build}
#define VER_D		0
#define COPYRIGHT_STRING "Copyright \xA9 ${copyrightYear} ${verInfo.companyName}. All Rights Reserved\\0"
	`, 'UTF8');
	}

	// Write version.cs
	fs.writeFileSync("version.cs", `
// Generated by build tool, do not edit
using System;
using System.Reflection;
[assembly: AssemblyCopyright("Copyright \u00A9 ${copyrightYear} ${verInfo.companyName}. All Rights Reserved")]
[assembly: AssemblyVersion("${verInfo.major}.${verInfo.minor}.${verInfo.build}")]
[assembly: AssemblyFileVersion("${verInfo.major}.${verInfo.minor}.${verInfo.build}")]
[assembly: AssemblyCompany("${verInfo.companyName}")]
[assembly: AssemblyProduct("${verInfo.productName}")]

static class BuildInfo
{
	public static DateTime Date = new DateTime(${now.getUTCFullYear()}, ${now.getUTCMonth()+1}, ${now.getUTCDate()}, ${now.getUTCHours()}, ${now.getUTCMinutes()}, ${now.getUTCSeconds()}, DateTimeKind.Utc);
}
	`, 'UTF8');

	fs.writeFileSync("version.props", `
<!-- Generated by build tool, do not edit -->
<Project>
  <PropertyGroup>
  	<Version Condition="'$(Variable)' == ''">${verInfo.major}.${verInfo.minor}.${verInfo.build}${verInfo.suffix ? verInfo.suffix : ""}</Version>
  </PropertyGroup>
</Project>	
	`, 'UTF8');


}

function git_check_internal(folder)
{
	var opts = { encoding: 'UTF8' };

	if (folder)
	{
		opts.cwd = folder
	}

	if (!folder)
		folder = '.';

	// Call git status
	var r = child_process.spawnSync("git", ["status"], opts);

	// Check success
	if (r.status != 0)
	{
		console.log(r.stdout);
		console.log("Failed to check git status");
		return false;
	}

	// Check clean
	if (!r.stdout.match(/nothing to commit, working tree clean/gi))
	{
		console.log(r.stdout);
		console.log("Working directory not clean, aborting!")
		return false;
	}

	// Get branch name
	var m = /^On branch (.*)/g.exec(r.stdout);
	console.log(`${folder} => ${m[1]}`);

	return true;
}

function git_check(folder)
{
	if (options.nogit)
		return;

	if (!git_check_internal(folder))
		process.exit(7);
}

function git_tag(folder)
{
	if (options.nogit)
		return;

	var tag = `b${options.version.major}.${options.version.minor}.${options.version.build}`;
	console.log(`Tagging ${folder ? folder : '.'} as ${tag}`)

	run_args("git", [
		"add", "."
	], folder);

	run_args("git", [
		"commit", "-m", tag, "--allow-empty"
	], folder);

	run_args("git", [
		"tag", "-f", tag
	], folder);

	run_args("git", [
		"push", "--quiet"
	], folder);

	run_args("git", [
		"push", "-f", "--tags", "--quiet"
	], folder);
}



/*
function fixPathForOs(path)
{
	if (options.disablePathFix)
		return path;

	// Don't replace / at the very start of an argument as it's probably a Windows
	// style command line switch.
	if (os.platform() == "win32")
		return path[0] + path.substring(1).replace(/\//g, '\\');
	else
		return path[0] + path.substring(1).replace(/\\/g, '/');
}
*/

function run_args(cmd, args, cwd)
{
	return run_core(cmd, args, { cwd: cwd });
}

// run_args a command
function run_core(cmd, args, opts)
{
	function escapeArg(x)  
	{
	    if (os.platform() == "win32")
	        return (x.indexOf(' ') >= 0 || x.indexOf('|') >= 0)? `"${x}"` : x;
	    else
	        return x.replace(/ /g, '\\ ');
	}

	if (!args)
		args = [];

    if (options.verbose)
    {
        console.log(escapeArg(cmd), args.map(escapeArg).join(" "));
    }

    var opts = Object.assign({
    	stdio: 'inherit'
    }, opts);

    var r = child_process.spawnSync(cmd, args, opts);

    // Failed to launch
    if (r.error)
    {
		if (!options.verbose)
		{
			console.log("\n\n");
			console.log(escapeArg(cmd), args.map(escapeArg).join(" "));
		}
		console.log("\nFailed", r.error.message);
		process.exit(7);
    }

    // Failed exit code?
	if (r.status != 0 && !opts.ignoreExitCode)
	{
		if (!options.verbose)
		{
			console.log("\n\n");
			console.log(escapeArg(cmd), args.map(escapeArg).join(" "));
		}
		console.log("\nFailed with exit code", r.status);
		process.exit(7);
	}

	return r.status;
}

function parseArgs(cmd)
{
	// Already an array?
	if (Array.isArray(cmd))
		return cmd;

	// Split command
	let args = [];
	let arg = "";
	let inQuote = false;
	for (var i=0; i<cmd.length; i++)
	{
		if (cmd[i] == '\"')
		{
			if (inQuote)
			{
				inQuote = false;
			}
			else
			{
				inQuote = true;
			}
			continue;
		}

		if (!inQuote && cmd[i] == ' ' || cmd[i] == '\t')
		{
			if (arg.length > 0)
			{
				args.push(arg);
				arg = "";
			}
		}
		else
		{
			arg += cmd[i];
		}
	}

	if (arg.length > 0)
		args.push(arg);

	return args;
}

var _cwd;

// Set cwd for the next cli command
function cwd(cwd)
{
	_cwd = cwd;
}

// Arguments to the function can be:
// 1. Space separated strings using double quotes for spaces
// 2. An array (which won't be parsed at all)
// All parse args are concatenated, first is used as command
// To change cwd, use the cli_cwd command above
function run()
{
	// Parse args
	var args = [];
	for (var i = 0; i < arguments.length; i++) 
	{
		args = args.concat(parseArgs(arguments[i]));
	}

	// First arg is the command
	var cmd = args.shift();

	// run_args the command
	var ret = run_args(cmd, args, _cwd);

	// Clear the cwd
	_cwd = null;
	return ret;
}


// Hacky, but dependency free way to prompt for a string
function prompt(message)
{
	// Generate a script
	var scriptFile = path.join(process.env["TEMP"], "prompt.bat");
	var responseFile = path.join(process.env["TEMP"], "response.txt");
	var script = `@echo off\r\nset /p response= \"${message}\"\r\nIF "%response%"=="" (ECHO. > ${responseFile} ) ELSE (ECHO %response% > ${responseFile})\r\n`;
	fs.writeFileSync(scriptFile, script, 'UTF8');

	// Delete response file
	if (fs.existsSync(responseFile))
		fs.unlinkSync(responseFile);

	// Run it
    child_process.spawnSync(scriptFile, [], { stdio: 'inherit', shell: true });

	var response;
	if (fs.existsSync(responseFile))
	{
		response = fs.readFileSync(responseFile, 'UTF8');
		fs.unlinkSync(responseFile);
	}

	fs.unlinkSync(scriptFile);

	return response.trim();
}


function upload(localfile, remotefile, chmod)
{
	run_args("c:\\cygwin64\\bin\\scp", [
		localfile,
		remotefile
	]);

	if (chmod)
	{
		var parts = remotefile.split(':');
		run_args("c:\\cygwin64\\bin\\ssh", [
			parts[0],
			"chmod", chmod, parts[1]
		]);
	}

}

function open_url(url)
{
	run_args("cmd.exe", [
		"/C", "start", url
	])
}

function validate_json(filename)
{
	try
	{
		JSON.parse(fs.readFileSync(filename, 'UTF8'))	
	}
	catch (err)
	{
		console.log(`JSON error in file ${filename}.`, err.message);
		process.exit(7);
	}

}



// Load the version info
if (fs.existsSync("version.json"))
{
	options.version = JSON.parse(fs.readFileSync("version.json", 'UTF8'));;
	if (!options.version.companyName)
	{
		options.version.companyName = "Topten Software";
		fs.writeFileSync("version.json", JSON.stringify(options.version, null, 4), 'UTF8');
	}
}
else
{
	options.version = {
		"major": 0,
		"minor": 1,
		"build": 1,
		"copyrightYear": new Date().getUTCFullYear(),
		"companyName": "Topten Software",
		"productName": path.basename(path.resolve('.'))
	}
	fs.writeFileSync("version.json", JSON.stringify(options.version, null, 4), 'UTF8');
}


// Check command line args
for (var i=0; i<process.argv.length; i++)
{
	var a = process.argv[i];

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
				options[parts[0]] = false;
			if (parts[1]=='true' || parts[1]=='yes')
				options[parts[0]] = true;
			else
				options[parts[0]] = parts[1];
		}
		else
		{
			options[parts[0]] = true;
		}
	}
	else
	{
		options.files.push(a);
	}
}

function msbuild(sln, proj, platform, config)
{
	console.log(`Building ${proj} (${config}|${platform})`);

	if (proj != "*")
	{
		invoke_msbuild([
			sln, 
			`/t:${proj.replace(/\./g, '_')}`,
			`/p:Configuration=${config}`,
            `/p:Platform=${platform}`, 
			`/verbosity:minimal`
			]);
	}
	else
	{
		invoke_msbuild([
			sln, 
			`/p:Configuration=${config}`,
			`/p:Platform=${platform}`,
			`/verbosity:minimal`
			]);
	}
}

// Invoke msbuild
function invoke_msbuild(args)
{
	run_args("C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\MSBuild\\Current\\Bin\\msbuild.exe", args);
}


// Store symbols
function symstore(filespec)
{
	run_args(path.join(__dirname, "symstore.exe"), [
		"add", "/r", "/f",
		filespec,
		"/s", options.symStorePath,
		"/t", `${options.version.productName} ${options.version.major}.${options.version.minor}`,
		"/v", `Build ${options.version.build}`
	]);
}

if (options.clockver)
{
	clock_version();
	process.exit(0);
}

module.exports = {
	options: options,
	clock_version: clock_version,
	git_check: git_check,
	git_tag: git_tag,
	run_args: run_args,
	run_core: run_core,
	cwd: cwd,
	run: run,
	prompt: prompt,
	upload: upload,
	open_url: open_url,
	validate_json: validate_json,
	msbuild: msbuild,
}