# How does Tasks handle status changes?

You can toggle a task‘s status by:

| #   | User mechanism                                                                    | Source-code location                                                                                                                                                                                                                                | Toggle behaviour                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | using the command (may be bound to a hotkey).                                     | [src/Commands/ToggleDone.ts](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/Commands/ToggleDone.ts)                                                                                                                           | toggles the line directly where the cursor is in the file inside Obsidian's vault.                                                                                                               |
| 2   | clicking on a checkbox of an inline task in Live Preview.                         | [src/LivePreviewExtension.ts](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/LivePreviewExtension.ts)                                                                                                                         | toggles the line directly where the checkbox is on the "document" of CodeMirror (the library that Obsidian uses to show text on screen).<br>That, in turn, updates the file in Obsidian's Vault. |
| 3   | clicking on a checkbox of an inline task in Reading mode.                         | uses a checkbox created by `TaskLineRenderer.renderTaskLine`.<br>There, the checkbox gets a click event handler.                                                                                                                                    | The click event listener of 3. and 4. uses `File::replaceTaskWithTasks()`.<br>That, in turn, updates the file in Obsidian‘s Vault (like 1, but it needs to find the correct line).               |
| 4   | clicking on a checkbox in query results (same for Reading mode and Live Preview). | As 3                                                                                                                                                                                                                                                | As 3                                                                                                                                                                                             |
| 5   | via 'Create or edit task' modal Status dropdown                                   | [src/ui/EditTask.svelte](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/ui/EditTask.svelte) and [src/Commands/CreateOrEdit.ts](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/Commands/CreateOrEdit.ts) | Not yet implemented: see [#1590](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/1590)                                                                                             |

Obsidian writes the changes to disk at its own pace.