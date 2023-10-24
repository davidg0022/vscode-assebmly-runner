import * as vscode from 'vscode';
import {exec} from 'child_process';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('asm');

let activeTextEditor = vscode.window.activeTextEditor;
let currentDebugFileExecutable = '';
let stoppingExecutable = false;

const updateConfig = (editor: any) => {

    const isAsmFile:boolean = editor && editor.document.fileName.endsWith('.asm');

    vscode.workspace.getConfiguration().update('asm.showRunIconInEditorTitleMenu', isAsmFile, vscode.ConfigurationTarget.Global);
};


export function activate(context: vscode.ExtensionContext) {

	const onChangeTextEditor = vscode.window.onDidChangeActiveTextEditor(editor => {
		activeTextEditor = editor;
		updateConfig(editor);
	});
	const getExecutablePath = async () => {
		var executablePath = vscode.workspace.getConfiguration().get('asm.executablePath');

		if (executablePath === undefined || executablePath === '') {
			executablePath = await vscode.window.showInputBox(
				{
					placeHolder: 'Enter executable path',
					value: ""
				}
			);
			vscode.workspace.getConfiguration().update('asm.executablePath', executablePath, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Saved executable path: ${executablePath}`);
			
		} 
		return executablePath;
	};
	
	const setRunningState = (isRunning: boolean) => {
		vscode.workspace.getConfiguration().update('asm.showStopIconInEditorTitleMenu', isRunning, vscode.ConfigurationTarget.Global);
	};

	const isTerminalVisible = async () => {
		return vscode.workspace.getConfiguration().get('asm.showTerminalInDebugMode');
	};

	const stopDebugging = async () => {
		const executableName = 'ollydbg.exe';
		stoppingExecutable = true;
		await killExecutable(executableName);
		if (currentDebugFileExecutable !== undefined && currentDebugFileExecutable !== '') {
			await killExecutable(currentDebugFileExecutable!);
		}
		setRunningState(false);
		stoppingExecutable = false;
	};

	async function killExecutable(executable: string): Promise<string>
	{
		return new Promise<string>((resolve, reject) => {
			exec('tasklist', (error, stdout) => {
				if (error) {
				  console.error(`Error checking for running processes: ${error}`);
				  reject(error.message);
				}
				if (stdout.toLowerCase().includes(executable.toLowerCase())) {
					console.log(`The executable ${executable} is running. Stopping it...`);
					exec(`taskkill /F /IM ${executable}`, (error, stdout) => {
						if (error) {
						  console.error(`Error stopping ${executable}: ${error}`);
						  resolve("error");
						}
						console.log(`${executable} has been successfully stopped.`);
						resolve(stdout);
					  });
				} else {
					console.log(`The executable ${executable} is not running.`);
					resolve(stdout);
				}
			});
		});
	}
	


	async function startExecutable(executable: string): Promise<string> {

		const documentFileName = activeTextEditor?.document.fileName;
		return new Promise<string>((resolve, reject) => {
		  exec(`${executable}`, (error, stdout) => {
			if (error && !stoppingExecutable) {
			  console.error(`Error starting ${executable}: ${error}`);
			  
			  const splitError = error.message.split('\n');
			  if (splitError.length > 1) {
				const pattern = /:(\d+):/;
				const match = splitError[1].match(pattern);

				if (match) {
					const lineNumber = match[1];
					const range = new vscode.Range(new vscode.Position(Number(lineNumber)-1, 0), new vscode.Position(Number(lineNumber)-1, 1000));
					const diagnostic = new vscode.Diagnostic(range, splitError[1], vscode.DiagnosticSeverity.Error);
					const diagnostics: vscode.Diagnostic[] = [];
					diagnostics.push(diagnostic);
					diagnosticCollection.set(vscode.Uri.file(documentFileName!), diagnostics);



				  console.log("Line Number:", lineNumber);
				} 
				else {
				  console.log("Line number not found in the error message.");
				}

				reject(`Errors: ${splitError[1]}`);
			  }
			  else {
				reject(`Error: ${error.message}`);
			  }
			}
			console.log(`${executable} has been successfully started and terminal minimized.`);
			resolve(stdout);
		  });
		});
	}


	function deleteFile(fileName: string) {
		const fs = require('fs');
		console.log(`Deleting file ${fileName}`);
		fs.unlink(fileName, (err: any) => {
			if (err) {
				console.error(err);
				return err;
			}
		});
	}


	const debug = vscode.commands.registerCommand('asm.debug', async () => {
		await stopDebugging();
		var executablePath = await getExecutablePath();
		console.log(executablePath);
		if (executablePath === undefined || executablePath === '') {
			vscode.window.showInformationMessage('No executable path set!');
			return;
		}
		if (activeTextEditor === undefined) {
			vscode.window.showInformationMessage('No active editor!');
			return;
		}
		const currentFile = activeTextEditor.document.fileName;

		var showTerminal = await isTerminalVisible();

		const lstFile = currentFile.slice(0, -3) + 'lst';
		const objFile = currentFile.slice(0, -3) + 'obj';
		const exeFile = currentFile.slice(0, -3) + 'exe';
		const nasmCommand = `"${executablePath}"\\nasm\\nasm.exe -fobj "${currentFile}" -l "${lstFile}" -I"${executablePath}"\\nasm\\\\`;
		
		var alinkCommand = "";
		if (showTerminal) {
			alinkCommand = `"${executablePath}\\nasm\\ALINK.EXE" -oPE -subsys console -entry start "${objFile}"`;
		}
		else {
			alinkCommand = `"${executablePath}\\nasm\\ALINK.EXE" -oPE -entry start "${objFile}"`;
		}
		const ollydbgCommand = `"${executablePath}\\ollydbg\\ollydbg.exe" "${exeFile}"`;

		var fileExecutableName:string|undefined = currentFile.slice(0, -3) + 'exe';
		fileExecutableName = fileExecutableName.split('\\').pop();

		currentDebugFileExecutable = fileExecutableName!;

		diagnosticCollection.clear();


		await startExecutable(nasmCommand);
		await startExecutable(alinkCommand);

		setRunningState(true);
		await startExecutable(ollydbgCommand);
		setRunningState(false);



		deleteFile(lstFile);
		deleteFile(objFile);
		deleteFile(exeFile);

	});

	const run = vscode.commands.registerCommand('asm.run', async () => {
		await stopDebugging();
		var executablePath = await getExecutablePath();
		if (executablePath === undefined || executablePath === '') {
			vscode.window.showInformationMessage('No executable path set!');
			return;
		}
		if (activeTextEditor === undefined) {
			vscode.window.showInformationMessage('No active editor!');
			return;
		}
		const currentFile = activeTextEditor.document.fileName;


		const lstFile = currentFile.slice(0, -3) + 'lst';
		const objFile = currentFile.slice(0, -3) + 'obj';
		const exeFile = currentFile.slice(0, -3) + 'exe';

		const nasmCommand = `"${executablePath}"\\nasm\\nasm.exe -fobj "${currentFile}" -l "${lstFile}" -I"${executablePath}"\\nasm\\\\`;
		const alinkCommand = `"${executablePath}\\nasm\\ALINK.EXE" -oPE -subsys console -entry start "${objFile}"`;
		const runCommand = `"${exeFile}"`;

		var fileExecutableName:string|undefined = currentFile.slice(0, -3) + 'exe';
		fileExecutableName = fileExecutableName.split('\\').pop();

		diagnosticCollection.clear();
		await startExecutable(nasmCommand);
		await startExecutable(alinkCommand);
		
		const terminal = vscode.window.createTerminal({
			name: 'Assembly',
			hideFromUser: false
		});
		terminal.show();
		terminal.sendText(runCommand);


		currentDebugFileExecutable = fileExecutableName!;

		
	});

	const stop = vscode.commands.registerCommand('asm.stop', async () => {
		await stopDebugging();
	});

	context.subscriptions.push(debug);
	context.subscriptions.push(stop);
	context.subscriptions.push(onChangeTextEditor);
}

export function deactivate() {}
