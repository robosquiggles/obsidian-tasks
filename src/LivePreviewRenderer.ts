import {
    EditorView,
    PluginValue,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view';

export const newLivePreviewRenderer = () => {
    return ViewPlugin.fromClass(LivePreviewRenderer, {
        eventHandlers: {
            mousedown: (event) => {
                console.log('MOUSEDOWN', event);
            },
            change: (event) => {
                console.log('CHANGE', event);
            },
            click: (event) => {
                console.log('CLICK', event);
            },
        },
    });
};

class LivePreviewRenderer implements PluginValue {
    private readonly view: EditorView;

    constructor(view: EditorView) {
        this.view = view;
    }

    public update(update: ViewUpdate): void {
        if (!update.changes.empty) {
            update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                if (
                    inserted.length === 1 &&
                    (inserted.sliceString(0) === ' ' ||
                        inserted.sliceString(0) === 'x')
                ) {
                    // This _could_ be a task that was clicked, as the change was
                    // merely inserting an 'x' or a ' '.
                    // I would now need to figure out whether there is actually
                    // a task here and whether its state was actually toggled.
                    console.log(
                        'inserted',
                        inserted,
                        inserted.toJSON(),
                        inserted.sliceString(0),
                    );
                }
            });
        }
    }
}
