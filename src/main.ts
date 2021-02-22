import * as vscode from 'vscode';
import * as path from 'path';
import {
    CMD_CHECK_MODEL_RUN, CMD_CHECK_MODEL_STOP, CMD_CHECK_MODEL_DISPLAY, CMD_SHOW_TLC_OUTPUT,
    CMD_CHECK_MODEL_CUSTOM_RUN, checkModel, displayModelChecking, stopModelChecking,
    showTlcOutput, checkModelCustom, CMD_CHECK_MODEL_RUN_AGAIN, runLastCheckAgain, doCheckModel, getSpecFiles
} from './commands/checkModel';
import { CMD_EVALUATE_SELECTION, evaluateSelection, CMD_EVALUATE_EXPRESSION,
    evaluateExpression } from './commands/evaluateExpression';
import { parseModule, CMD_PARSE_MODULE } from './commands/parseModule';
import { visualizeTlcOutput, CMD_VISUALIZE_TLC_OUTPUT } from './commands/visualizeOutput';
import { exportModuleToTex, exportModuleToPdf, CMD_EXPORT_TLA_TO_TEX,
    CMD_EXPORT_TLA_TO_PDF } from './commands/exportModule';
import { TlaOnTypeFormattingEditProvider } from './formatters/tla';
import { CfgOnTypeFormattingEditProvider } from './formatters/cfg';
import { TlaCodeActionProvider } from './actions';
import { TlaDocumentSymbolsProvider } from './symbols/tlaSymbols';
import { LANG_TLAPLUS, LANG_TLAPLUS_CFG, exists, readFile, writeFile } from './common';
import { TlaCompletionItemProvider } from './completions/tlaCompletions';
import { CfgCompletionItemProvider } from './completions/cfgCompletions';
import { TlaDeclarationsProvider, TlaDefinitionsProvider } from './declarations/tlaDeclarations';
import { TlaDocumentInfos } from './model/documentInfo';
import { syncTlcStatisticsSetting, listenTlcStatConfigurationChanges } from './commands/tlcStatisticsCfg';

const TLAPLUS_FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file', language: LANG_TLAPLUS };
const TLAPLUS_CFG_FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file', language: LANG_TLAPLUS_CFG };
const CHANGELOG_URL = vscode.Uri.parse('https://github.com/alygin/vscode-tlaplus/blob/master/CHANGELOG.md#change-log');

const tlaDocInfos = new TlaDocumentInfos();

// Holds all the error messages
let diagnostic: vscode.DiagnosticCollection;

/**
 * Extension entry point.
 */
export function activate(context: vscode.ExtensionContext): void {
    diagnostic = vscode.languages.createDiagnosticCollection(LANG_TLAPLUS);
    context.subscriptions.push(
        vscode.commands.registerCommand(
            CMD_PARSE_MODULE,
            () => parseModule(diagnostic)),
        vscode.commands.registerCommand(
            CMD_EXPORT_TLA_TO_TEX,
            () => exportModuleToTex(context)),
        vscode.commands.registerCommand(
            CMD_EXPORT_TLA_TO_PDF,
            () => exportModuleToPdf(context)),
        vscode.commands.registerCommand(
            CMD_CHECK_MODEL_RUN,
            (uri) => checkModel(uri, diagnostic, context)),
        vscode.commands.registerCommand(
            CMD_CHECK_MODEL_RUN_AGAIN,
            () => runLastCheckAgain(diagnostic, context)),
        vscode.commands.registerCommand(
            CMD_CHECK_MODEL_CUSTOM_RUN,
            () => checkModelCustom(diagnostic, context)),
        vscode.commands.registerCommand(
            CMD_SHOW_TLC_OUTPUT,
            () => showTlcOutput()),
        vscode.commands.registerCommand(
            CMD_CHECK_MODEL_STOP,
            () => stopModelChecking()),
        vscode.commands.registerCommand(
            CMD_CHECK_MODEL_DISPLAY,
            () => displayModelChecking(context)),
        vscode.commands.registerCommand(
            CMD_VISUALIZE_TLC_OUTPUT,
            () => visualizeTlcOutput(context)),
        vscode.commands.registerCommand(
            CMD_EVALUATE_SELECTION,
            () => evaluateSelection(diagnostic, context)),
        vscode.commands.registerCommand(
            CMD_EVALUATE_EXPRESSION,
            () => evaluateExpression(diagnostic, context)),
        vscode.languages.registerCodeActionsProvider(
            TLAPLUS_FILE_SELECTOR,
            new TlaCodeActionProvider(),
            { providedCodeActionKinds: [ vscode.CodeActionKind.Source ] }),
        vscode.debug.registerDebugAdapterDescriptorFactory(
            LANG_TLAPLUS,
            new TLADebugAdapterServerDescriptorFactory()),
        vscode.languages.registerOnTypeFormattingEditProvider(
            TLAPLUS_FILE_SELECTOR,
            new TlaOnTypeFormattingEditProvider(),
            '\n', 'd', 'e', 'f', 'r'),
        vscode.languages.registerOnTypeFormattingEditProvider(
            TLAPLUS_CFG_FILE_SELECTOR,
            new CfgOnTypeFormattingEditProvider(),
            '\n'),
        vscode.languages.registerDocumentSymbolProvider(
            TLAPLUS_FILE_SELECTOR,
            new TlaDocumentSymbolsProvider(tlaDocInfos),
            { label: 'TLA+' }),
        vscode.languages.registerCompletionItemProvider(
            TLAPLUS_FILE_SELECTOR,
            new TlaCompletionItemProvider(tlaDocInfos)),
        vscode.languages.registerCompletionItemProvider(
            TLAPLUS_CFG_FILE_SELECTOR,
            new CfgCompletionItemProvider()),
        vscode.languages.registerDeclarationProvider(
            TLAPLUS_FILE_SELECTOR,
            new TlaDeclarationsProvider(tlaDocInfos)
        ),
        vscode.languages.registerDefinitionProvider(
            TLAPLUS_FILE_SELECTOR,
            new TlaDefinitionsProvider(tlaDocInfos)
        ),
        vscode.commands.registerCommand(
            'tlaplus.debug.checkAndDebugEditorContents',
            (uri) => checkAndDebugSpec(uri, diagnostic, context)
        ),
        vscode.commands.registerCommand(
            'tlaplus.debug.debugEditorContents',
            (uri) => debugSpec(uri, diagnostic, context)
        ),
        vscode.languages.registerEvaluatableExpressionProvider(
            TLAPLUS_FILE_SELECTOR, {
            // https://github.com/microsoft/vscode/issues/89084
            // https://github.com/microsoft/vscode/issues/24520
            // https://github.com/microsoft/vscode-mock-debug/blob/ (stupid linter!)
            // 393ee2b2443e270bacd9f11fa219c39a88fc987d/src/extension.ts#L63-L84
            // Also see wordPattern in tlaplus-lang-config.json that drops "@"
            // and "'" compared to VSCode's standard wordPattern.
            // https://github.com/alygin/vscode-tlaplus/issues/200
                provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position):
                    vscode.ProviderResult<vscode.EvaluatableExpression> {
                    const wordRange = document.getWordRangeAtPosition(position);
                    return wordRange ? new vscode.EvaluatableExpression(wordRange,
                        encodeURI(
                            'tlaplus://' + document.fileName + '?' + document.getText(wordRange) + '#' +
                            (wordRange.start.line + 1) + ' ' +
                            (wordRange.start.character + 1) + ' ' +
                            (wordRange.end.line + 1) + ' ' +
                            // For SANY, the location of the first character in a file is:
                            //   1 1 1 1
                            // whereas VSCode defines it to be:
                            //   1 1 1 2
                            (wordRange.end.character /** + 1 */))) : undefined;
                }
            })
    );
    syncTlcStatisticsSetting()
        .catch((err) => console.error(err))
        .then(() => listenTlcStatConfigurationChanges(context.subscriptions));
    showChangeLog(context.extensionPath)
        .catch((err) => console.error(err));
}

async function showChangeLog(extPath: string) {
    const pkgData = await readFile(`${extPath}${path.sep}package.json`);
    const curVersion = JSON.parse(pkgData).version;
    const prevFilePath = `${extPath}${path.sep}version`;
    let prevVersion;
    if (await exists(prevFilePath)) {
        prevVersion = await readFile(prevFilePath);
    }
    if (getMajorMinor(curVersion) === getMajorMinor(prevVersion)) {
        return;
    }
    await writeFile(prevFilePath, curVersion);
    const showOpt = 'Show changelog';
    const dismissOpt = 'Dismiss';
    const opt = await vscode.window.showInformationMessage('TLA+ extension has been updated.', showOpt, dismissOpt);
    if (opt === showOpt) {
        vscode.commands.executeCommand('vscode.open', CHANGELOG_URL);
    }
}

function getMajorMinor(version: string | undefined): string | undefined {
    if (!version || version === '') {
        return undefined;
    }
    const matches = /^(\d+.\d+)/g.exec(version);
    return matches ? matches[1] : undefined;
}

class TLADebugAdapterServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined):
        vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            return new vscode.DebugAdapterServer(session.configuration['port']);
    }
}

/**
 * Attaches the DAP front-end to an already running TLC debugger.
 */
export async function debugSpec(
    resource: vscode.Uri | undefined,
    diagnostic: vscode.DiagnosticCollection,
    context: vscode.ExtensionContext
): Promise<void> {
    let targetResource = resource;
    if (!targetResource && vscode.window.activeTextEditor) {
        // Since this command is registered as a button on the editor menu, I don't
        // think this branch is ever taken.  It's here because the DAP example has it.
        targetResource = vscode.window.activeTextEditor.document.uri;
    }
    if (targetResource) {
        // Attaching to a separately launched TLC leaves the result view (webview) empty.
        // However, TLC sends its output via the DAP Output event
        // (https://microsoft.github.io/debug-adapter-protocol/specification#Events_Output)
        // to VSCode.  Somebody has to figure out how to wire this up. In the meantime,
        // users have to manually "parse" the output on VSCode's DebugConsole. Unfortunately,
        // it is TLC's '-tool' output containing "@!@!@" markers around each message.
        vscode.debug.startDebugging(undefined, {
            type: 'tlaplus',
            name: 'Debug Spec',
            request: 'launch',
            program: targetResource.fsPath
        });
    }
}

/**
 * Runs TLC in debugger mode and attaches the DAP front-end.
 */
export async function checkAndDebugSpec(
    resource: vscode.Uri | undefined,
    diagnostic: vscode.DiagnosticCollection,
    context: vscode.ExtensionContext
): Promise<void> {
    let targetResource = resource;
    if (!targetResource && vscode.window.activeTextEditor) {
        // Since this command is registered as a button on the editor menu, I don't
        // think this branch is ever taken.  It's here because the DAP example has it.
        targetResource = vscode.window.activeTextEditor.document.uri;
    }
    if (targetResource) {
        const specFiles = await getSpecFiles(targetResource);
        if (!specFiles) {
            return;
        }
        // Randomly select a port on which we request the debugger to listen
        const port = Math.floor(Math.random() * (64510 - 1025 + 1)) + 1025;
        // false => Don't open the result view, it's empty anyway (see above).
        // Don't await doCheckModel because it only returns after TLC terminates.
        doCheckModel(specFiles, true, context, diagnostic, ['-debugger', `port='${port}'`]);
        setTimeout(function() {
            if (targetResource) {
                vscode.debug.startDebugging(undefined, {
                    type: 'tlaplus',
                    name: 'Debug Spec',
                    request: 'launch',
                    program: targetResource.fsPath,
                    port: port
                });
            }
        }, 2_000); // Wait two seconds hoping this is enough for TLC to listen on 4712.
        // In the future, we have to come up with a non-racy handshake.  What would be
        // way more elegant is for VSCode to a) open a serversocker on a free port, b)
        // launch the TLC process passing the port number, and c) for TLC to connect
        // to the given port.
    }
}
