import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import { pathToUri } from './common';
import { JavaVersionParser } from './parsers/javaVersion';

const CFG_JAVA_HOME = 'tlaplus.java.home';
const CFG_JAVA_OPTIONS = 'tlaplus.java.options';

export enum TlaTool {
    PLUS_CAL = 'pcal.trans',
    SANY = 'tla2sany.SANY',
    TLC = 'tlc2.TLC'
}

const NO_ERROR = 0;
const MIN_TLA_ERROR = 10;           // Exit codes not related to tooling start from this number
const LOWEST_JAVA_VERSION = 8;
const javaCmd = 'java' + (process.platform === 'win32' ? '.exe' : '');
const toolsJarPath = path.resolve(__dirname, '../../tools/tla2tools.jar');
const defaultGCArg = '-XX:+UseParallelGC';
const toolsBaseArgs: ReadonlyArray<string> = ['-cp', toolsJarPath];

let lastUsedJavaHome: string | undefined;
let cachedJavaPath: string | undefined;

/**
 * Thrown when there's some problem with Java or TLA+ tooling.
 */
export class ToolingError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class JavaVersion {
    static UNKNOWN_VERSION = '?';

    constructor(
        readonly version: string,
        readonly fullOutput: string[]
    ) {}
}

/**
 * Executes a TLA+ tool.
 */
export async function runTool(toolName: string, filePath: string, toolArgs?: string[]): Promise<ChildProcess> {
    const javaPath = await obtainJavaPath();
    const args = buildJavaOptions().concat(toolsBaseArgs);
    args.push(toolName);
    if (toolArgs) {
        toolArgs.forEach(arg => args.push(arg));
    }
    args.push(filePath);
    const proc = spawn(javaPath, args, { cwd: path.dirname(filePath) });
    addReturnCodeHandler(proc, toolName);
    return proc;
}

/**
 * Kills the given process.
 */
export function stopProcess(p: cp.ChildProcess) {
    if (!p.killed) {
        p.kill('SIGINT');
    }
}

export function reportBrokenToolchain(err: any) {
    console.log('Toolchain problem: ' + err.message);
    vscode.window.showErrorMessage('Toolchain is broken');
}

async function obtainJavaPath(): Promise<string> {
    const javaHome = vscode.workspace.getConfiguration().get<string>(CFG_JAVA_HOME);
    if (cachedJavaPath && javaHome === lastUsedJavaHome) {
        return cachedJavaPath;
    }
    const javaPath = buildJavaPath();
    cachedJavaPath = javaPath;
    lastUsedJavaHome = javaHome;
    await checkJavaVersion(javaPath);
    return javaPath;
}

/**
 * Builds path to the Java executable based on the configuration.
 */
function buildJavaPath(): string {
    let javaPath = javaCmd;
    const javaHome = vscode.workspace.getConfiguration().get<string>(CFG_JAVA_HOME);
    if (javaHome) {
        const homeUri = pathToUri(javaHome);
        javaPath = homeUri.fsPath + path.sep + 'bin' + path.sep + javaCmd;
        if (!fs.existsSync(javaPath)) {
            throw new ToolingError('Java executable not found. Check the Java Home configuration property.');
        }
    }
    return javaPath;
}

/**
 * Builds an array of options to pass to Java process when running TLA tools.
 */
function buildJavaOptions(): string[] {
    const javaOptions = vscode.workspace.getConfiguration().get<string>(CFG_JAVA_OPTIONS) || '';
    const opts = javaOptions.split(' ').map(opt => opt.trim()).filter(opt => opt !== '');
    // If GC is provided by the user, don't use the default one. Otherwise, add GC option.
    const gcOption = opts.find(opt => opt.startsWith('-XX:+Use') && opt.endsWith('GC'));
    if (!gcOption) {
        opts.push(defaultGCArg);
    }
    return opts;
}

/**
 * Executes java -version and analyzes, if the version is 1.8 or higher.
 */
async function checkJavaVersion(javaPath: string) {
    const proc = spawn(javaPath, ['-version']);
    const parser = new JavaVersionParser(proc.stderr);
    const ver = await parser.readAll();
    if (ver.version === JavaVersion.UNKNOWN_VERSION) {
        ver.fullOutput.forEach(line => console.debug(line));
        throw new ToolingError('Error while obtaining Java version. Check the Java Home configuration property.');
    }
    let num = ver.version;
    if (num.startsWith('1.')) {
        num = num.substring(2);
    }
    const pIdx = num.indexOf('.');
    if (pIdx > 0 && parseInt(num.substring(0, pIdx), 10) >= LOWEST_JAVA_VERSION) {
        return;
    }
    vscode.window.showWarningMessage(`Unexpected Java version: ${ver.version}`);
}

/**
 * Adds a handler to the given TLA+ tooling process that captures various system errors.
 */
function addReturnCodeHandler(proc: ChildProcess, toolName?: string) {
    const stderr: string[] = [];
    proc.stderr.on('data', chunk => {
        stderr.push(String(chunk));
    });
    proc.on('close', exitCode => {
        if (exitCode !== NO_ERROR && exitCode < MIN_TLA_ERROR) {
            const details = stderr.join('\n');
            vscode.window.showErrorMessage(`Error running ${toolName} (exit code ${exitCode})\n${details}`);
        }
    });
}
