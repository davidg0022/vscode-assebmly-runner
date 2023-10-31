import * as vscode from 'vscode';
import {exec} from 'child_process';
import {join} from 'path';
import * as fs from 'fs';
import * as os from 'os';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('asm');

let activeTextEditor = vscode.window.activeTextEditor;
let currentDebugFileExecutable = '';
let stoppingExecutable = false;

const updateConfig = (editor: any) => {

    const isAsmFile:boolean = editor && editor.document.fileName.endsWith('.asm');

    vscode.workspace.getConfiguration().update('asm.showRunIconInEditorTitleMenu', isAsmFile, vscode.ConfigurationTarget.Global);
};


export function activate(context: vscode.ExtensionContext) {
	if (os.platform() !== 'win32') {
        vscode.window.showWarningMessage('Assembly Runner extension is only available on Windows.');
        return;
    }

	var isBuiltInExtension:boolean = false;

	function checkIfBuiltInExtension():boolean {
		const parentDir = join(__dirname, '../../../../../../');
		const pathExists = fs.existsSync(parentDir);
		if(!pathExists)
		{
			return false;
		}
		const ollydbgPath = join(parentDir, 'ollydbg');
		const nasmPath = join(parentDir, 'nasm');
		const ollydbgPathExists = fs.existsSync(ollydbgPath);
		const nasmPathExists = fs.existsSync(nasmPath);
		if(!ollydbgPathExists || !nasmPathExists)
		{
			return false;
		}
		return true;
	}
	var isBuiltInExtension = checkIfBuiltInExtension();
	updateConfig(activeTextEditor);

	const onChangeTextEditor = vscode.window.onDidChangeActiveTextEditor(editor => {
		activeTextEditor = editor;
		updateConfig(editor);
	});


	const getExecutablePath = async () => {
		if (isBuiltInExtension) {
			return join(__dirname, '../../../../../../');
		}

		var executablePath = vscode.workspace.getConfiguration().get('asm.executablePath');

		if (executablePath === undefined || executablePath === '') {
			executablePath = await vscode.window.showInputBox(
				{
					placeHolder: 'Enter the path to the folder containing nasm and ollydbg (asm_tools)',
					value: ""
				}
			);
			
			if (executablePath === undefined || executablePath === '') {
				vscode.window.showInformationMessage('Please enter a valid path!');
				return '';
			}

			// check if the path contains nasm and ollydbg folders
			const ollydbgPath = join(`${executablePath}`, 'ollydbg');
			const nasmPath = join(`${executablePath}`, 'nasm');
			
			const ollydbgPathExists = fs.existsSync(ollydbgPath);
			const nasmPathExists = fs.existsSync(nasmPath);

			if (!ollydbgPathExists || !nasmPathExists) {
				vscode.window.showErrorMessage('Invalid assembly tools path! Path must contain nasm and ollydbg folders and the executable files inside them.');
				return '';
			}
			
			if (executablePath !== undefined && executablePath !== '') {
				vscode.workspace.getConfiguration().update('asm.executablePath', executablePath, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Saved assembly tools path: ${executablePath}`);
				return executablePath;
			}
			
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
				  vscode.window.showErrorMessage(`Error: ${splitError[1]}`);
				} 
				else {
				  console.log("Line number not found in the error message.");
				}

				vscode.window.showErrorMessage(`Error: ${error.message}`);
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
		if (executablePath === undefined || executablePath === '') {
			vscode.window.showInformationMessage('Assembly tools path not set!');
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



		const deleteExe = vscode.workspace.getConfiguration().get('asm.deleteExeFileAfterRun');
		const deleteLst = vscode.workspace.getConfiguration().get('asm.deleteLstFileAfterRun');
		const deleteObj = vscode.workspace.getConfiguration().get('asm.deleteObjFileAfterRun');

		if (deleteLst)
		{
			deleteFile(lstFile);
		}
		if (deleteObj)
		{
			deleteFile(objFile);
		}
		if (deleteExe)
		{
			deleteFile(exeFile);
		}

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

	const template = vscode.commands.registerCommand('asm.template', async () => {
		const template = 
`bits 32 ;assembling for the 32 bits architecture
global start

; we ask the assembler to give global visibility to the symbol called start 
;(the start label will be the entry point in the program) 
extern exit ; we inform the assembler that the exit symbol is foreign; it exists even if we won't be defining it
import exit msvcrt.dll  ; we specify the external library that defines the symbol
		; msvcrt.dll contains exit, printf and all the other important C-runtime functions

; our variables are declared here (the segment is called data) 
segment data use32 class=data
; ... 

; the program code will be part of a segment called code
segment code use32 class=code
start:
; ... 

	; call exit(0) ), 0 represents status code: SUCCESS
	push dword 0 ; saves on stack the parameter of the function exit
	call [exit] ; function exit is called in order to end the execution of the program`;
		// Get the current text editor
		const editor = vscode.window.activeTextEditor;
		// check if the editor has a file open with text in it
		const editorText = editor?.document.getText();

		if (editorText !== undefined && editorText !== '') {
			const confirmation = await vscode.window.showInformationMessage(
				'Are you sure you want to replace the current file with the assembly template?',
				'Yes', 'No'
			);
			if (confirmation === 'Yes') {
				editor?.edit(editBuilder => {
					editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1000, 1000)), template);
				});
			}
		}
		else
		{
			editor?.edit(editBuilder => {
				editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1000, 1000)), template);
			});
		}

	});

	context.subscriptions.push(debug);
	context.subscriptions.push(stop);
	context.subscriptions.push(run);
	context.subscriptions.push(template);
	context.subscriptions.push(onChangeTextEditor);
}

export function deactivate() {}
