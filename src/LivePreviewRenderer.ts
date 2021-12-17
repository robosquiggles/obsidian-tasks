import { MarkdownView, Plugin, Vault, Workspace } from 'obsidian';
import { toggleLine } from './Commands/ToggleDone';

export class LivePreviewRenderer {
    private readonly plugin: Plugin;
    private readonly vault: Vault;
    private readonly workspace: Workspace;

    constructor({
        plugin,
        vault,
        workspace,
    }: {
        plugin: Plugin;
        vault: Vault;
        workspace: Workspace;
    }) {
        this.plugin = plugin;
        this.vault = vault;
        this.workspace = workspace;

        this.plugin.registerDomEvent(
            document,
            'click',
            this.clickHandler.bind(this),
        );
    }

    private async clickHandler(event) {
        // TODO: only listen on checkbox events.
        try {
            const activeView = this.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                return false;
            }
            const path = activeView.file.path;
            const eventOffset = (activeView.editor as any).cm.posAtDOM(
                event.target,
            );
            const eventLineNumber =
                activeView.editor.offsetToPos(eventOffset).line;
            const line = activeView.editor.getLine(eventLineNumber);
            const toggled = toggleLine({ line, path });
            console.log('TOGL', toggled);
            activeView.editor.setLine(eventLineNumber, toggled);

            // TODO: need two clicks to toggl
            // TODO: only stop propagation in case of task.
            event.stopPropagation();
        } catch {
            console.log('outside doc clicked');
        }

        // TODO: figure out if returning a bool makes a difference.
        return true;
    }
}
