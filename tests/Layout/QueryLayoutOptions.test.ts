import { QueryLayoutOptions, parseQueryShowHideOptions } from '../../src/Layout/QueryLayoutOptions';

describe('parsing query show/hide layout options', () => {
    function parseOptionAndCheck(options: QueryLayoutOptions, option: string, hide: boolean) {
        const success = parseQueryShowHideOptions(options, option, hide);
        expect(success).toEqual(true);
    }

    it('should parse "tree" option', () => {
        const option = 'tree';
        const hiddenByDefault = true;

        const options = new QueryLayoutOptions();
        expect(options.hideTree).toBe(hiddenByDefault);

        parseOptionAndCheck(options, option, !hiddenByDefault);
        expect(options.hideTree).toEqual(!hiddenByDefault);

        parseOptionAndCheck(options, option, hiddenByDefault);
        expect(options.hideTree).toEqual(hiddenByDefault);
    });
});
