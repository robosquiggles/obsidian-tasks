import { getSettings } from '../Config/Settings';
import type { IQuery } from '../IQuery';
import { QueryLayoutOptions, parseQueryShowHideOptions } from '../Layout/QueryLayoutOptions';
import { TaskLayoutOptions, parseTaskShowHideOptions } from '../Layout/TaskLayoutOptions';
import { errorMessageForException } from '../lib/ExceptionTools';
import { logging } from '../lib/logging';
import { expandPlaceholders } from '../Scripting/ExpandPlaceholders';
import { makeQueryContext } from '../Scripting/QueryContext';
import type { Task } from '../Task/Task';
import type { OptionalTasksFile } from '../Scripting/TasksFile';
import { Explainer } from './Explain/Explainer';
import type { Filter } from './Filter/Filter';
import * as FilterParser from './FilterParser';
import type { Grouper } from './Group/Grouper';
import { TaskGroups } from './Group/TaskGroups';
import { QueryResult } from './QueryResult';
import { continueLines } from './Scanner';
import { SearchInfo } from './SearchInfo';
import { Sort } from './Sort/Sort';
import type { Sorter } from './Sort/Sorter';
import { Statement } from './Statement';

export class Query implements IQuery {
    /** Note: source is the raw source, before expanding any placeholders */
    public readonly source: string;
    public readonly tasksFile: OptionalTasksFile;

    private _limit: number | undefined = undefined;
    private _taskGroupLimit: number | undefined = undefined;
    private readonly _taskLayoutOptions: TaskLayoutOptions = new TaskLayoutOptions();
    private readonly _queryLayoutOptions: QueryLayoutOptions = new QueryLayoutOptions();
    private readonly _filters: Filter[] = [];
    private _error: string | undefined = undefined;
    private readonly _sorting: Sorter[] = [];
    private readonly _grouping: Grouper[] = [];
    private _ignoreGlobalQuery: boolean = false;

    private readonly hideOptionsRegexp = /^(hide|show) +(.*)/i;
    private readonly shortModeRegexp = /^short/i;
    private readonly fullModeRegexp = /^full/i;
    private readonly explainQueryRegexp = /^explain/i;
    private readonly ignoreGlobalQueryRegexp = /^ignore global query/i;

    logger = logging.getLogger('tasks.Query');
    // Used internally to uniquely log each query execution in the console.
    private readonly _queryId: string;

    private readonly limitRegexp = /^limit (groups )?(to )?(\d+)( tasks?)?/i;

    private readonly commentRegexp = /^#.*/;

    constructor(source: string, tasksFile: OptionalTasksFile = undefined) {
        this._queryId = this.generateQueryId(10);

        this.source = source;
        this.tasksFile = tasksFile;

        this.debug(`Creating query: ${this.formatQueryForLogging()}`);

        const anyContinuationLinesRemoved = continueLines(source);

        const anyPlaceholdersExpanded: Statement[] = [];
        for (const statement of anyContinuationLinesRemoved) {
            const expandedStatements = this.expandPlaceholders(statement, tasksFile);
            if (this.error !== undefined) {
                // There was an error expanding placeholders.
                return;
            }
            anyPlaceholdersExpanded.push(...expandedStatements);
        }

        for (const statement of anyPlaceholdersExpanded) {
            try {
                this.parseLine(statement);
                if (this.error !== undefined) {
                    return;
                }
            } catch (e) {
                let message;
                if (e instanceof Error) {
                    message = e.message;
                } else {
                    message = 'Unknown error';
                }

                this.setError(message, statement);
                return;
            }
        }
    }

    public get filePath(): string | undefined {
        return this.tasksFile?.path ?? undefined;
    }

    public get queryId(): string {
        return this._queryId;
    }

    private parseLine(statement: Statement) {
        const line = statement.anyPlaceholdersExpanded;
        switch (true) {
            case this.shortModeRegexp.test(line):
                this._queryLayoutOptions.shortMode = true;
                break;
            case this.fullModeRegexp.test(line):
                this._queryLayoutOptions.shortMode = false;
                break;
            case this.explainQueryRegexp.test(line):
                this._queryLayoutOptions.explainQuery = true;
                break;
            case this.ignoreGlobalQueryRegexp.test(line):
                this._ignoreGlobalQuery = true;
                break;
            case this.limitRegexp.test(line):
                this.parseLimit(line);
                break;
            case this.parseSortBy(line, statement):
                break;
            case this.parseGroupBy(line, statement):
                break;
            case this.hideOptionsRegexp.test(line):
                this.parseHideOptions(line);
                break;
            case this.commentRegexp.test(line):
                // Comment lines are ignored
                break;
            case this.parseFilter(line, statement):
                break;
            default:
                this.setError('do not understand query', statement);
        }
    }

    private formatQueryForLogging() {
        return `[${this.source.split('\n').join(' ; ')}]`;
    }

    private expandPlaceholders(statement: Statement, tasksFile: OptionalTasksFile): Statement[] {
        const source = statement.anyContinuationLinesRemoved;
        if (source.includes('{{') && source.includes('}}')) {
            if (this.tasksFile === undefined) {
                this._error = `The query looks like it contains a placeholder, with "{{" and "}}"
but no file path has been supplied, so cannot expand placeholder values.
The query is:
${source}`;
                return [statement];
            }
        }

        // TODO Do not complain about any placeholder errors in comment lines
        // TODO Give user error info if they try and put a string in a regex search
        let expandedSource: string = source;
        if (tasksFile) {
            const queryContext = makeQueryContext(tasksFile);
            try {
                expandedSource = expandPlaceholders(source, queryContext);
            } catch (error) {
                if (error instanceof Error) {
                    this._error = error.message;
                } else {
                    this._error = 'Internal error. expandPlaceholders() threw something other than Error.';
                }
                return [statement];
            }
        }

        return this.createStatementsFromExpandedPlaceholders(expandedSource, statement);
    }

    private createStatementsFromExpandedPlaceholders(expandedSource: string, statement: Statement) {
        const expandedSourceLines = expandedSource.split('\n');
        if (expandedSourceLines.length === 1) {
            // Save any expanded text back in to the statement:
            statement.recordExpandedPlaceholders(expandedSource.trim());
            return [statement];
        }

        // The expanded source is more than one line, so we will need to create multiple statements.
        // This only happens if the placeholder was a multiple-line property from the query file.
        const newStatements: Statement[] = [];
        let countOfValidStatements = 0;
        for (const expandedSourceLine of expandedSourceLines) {
            const trimmedExpandedSourceLine = expandedSourceLine.trim();
            if (trimmedExpandedSourceLine.length <= 0) {
                continue;
            }
            countOfValidStatements += 1;
            const counter = `: statement ${countOfValidStatements} after expansion of placeholder`;
            const newStatement = new Statement(
                statement.rawInstruction + counter,
                statement.anyContinuationLinesRemoved + counter,
            );
            newStatement.recordExpandedPlaceholders(trimmedExpandedSourceLine);
            newStatements.push(newStatement);
        }
        return newStatements;
    }

    /**
     *
     * Appends {@link q2} to this query.
     *
     * @note At time of writing, this query language appears to play nicely with combining queries.
     *
     * More formally, the concatenation operation on the query language:
     *     * Is closed (concatenating two queries is another valid query)
     *     * Is not commutative (q1.append(q2) !== q2.append(q1))
     *
     * And the semantics of the combination are straight forward:
     *     * Combining two queries appends their filters
     *           (assuming that the filters are pure functions, filter concatenation is commutative)
     *     * Combining two queries appends their sorting instructions. (this is not commutative)
     *     * Combining two queries appends their grouping instructions. (this is not commutative)
     *     * Successive limit instructions overwrite previous ones.
     *
     * @param {Query} q2
     * @return {Query} The combined query
     */
    public append(q2: Query): Query {
        if (this.source === '') return q2;
        if (q2.source === '') return this;
        return new Query(`${this.source}\n${q2.source}`, this.tasksFile);
    }

    /**
     * Generate a text description of the contents of this query.
     *
     * This does not show any global filter and global query.
     * Use {@link explainResults} if you want to see any global query and global filter as well.
     */
    public explainQuery(): string {
        const explainer = new Explainer();
        return explainer.explainQuery(this);
    }

    public get limit(): number | undefined {
        return this._limit;
    }

    public get taskGroupLimit(): number | undefined {
        return this._taskGroupLimit;
    }

    get taskLayoutOptions(): TaskLayoutOptions {
        return this._taskLayoutOptions;
    }

    public get queryLayoutOptions(): QueryLayoutOptions {
        return this._queryLayoutOptions;
    }

    public get filters(): Filter[] {
        return this._filters;
    }

    /**
     * Add a new filter to this Query.
     *
     * At the time of writing, it is intended to allow tests to create filters
     * programatically, for things that can not yet be done via 'filter by function'.
     * @param filter
     */
    public addFilter(filter: Filter) {
        this._filters.push(filter);
    }

    public get sorting() {
        return this._sorting;
    }

    /**
     * Return the {@link Grouper} objects that represent any `group by` instructions in the tasks block.
     */
    public get grouping(): Grouper[] {
        return this._grouping;
    }

    public get error(): string | undefined {
        return this._error;
    }

    private setError(message: string, statement: Statement) {
        this._error = Query.generateErrorMessage(statement, message);
    }

    private static generateErrorMessage(statement: Statement, message: string) {
        if (statement.allLinesIdentical()) {
            return `${message}
Problem line: "${statement.rawInstruction}"`;
        } else {
            return `${message}
Problem statement:
${statement.explainStatement('    ')}
`;
        }
    }

    public get ignoreGlobalQuery(): boolean {
        return this._ignoreGlobalQuery;
    }

    public applyQueryToTasks(tasks: Task[]): QueryResult {
        this.debug(`Executing query: ${this.formatQueryForLogging()}`);

        const searchInfo = new SearchInfo(this.tasksFile, tasks);

        // Custom filter (filter by function) does not report the instruction line in any exceptions,
        // for performance reasons. So we keep track of it here.
        let possiblyBrokenStatement: Statement | undefined = undefined;
        try {
            this.filters.forEach((filter) => {
                possiblyBrokenStatement = filter.statement;
                tasks = tasks.filter((task) => filter.filterFunction(task, searchInfo));
            });
            possiblyBrokenStatement = undefined;

            const { debugSettings } = getSettings();
            const tasksSorted = debugSettings.ignoreSortInstructions ? tasks : Sort.by(this.sorting, tasks, searchInfo);
            const tasksSortedLimited = tasksSorted.slice(0, this.limit);

            const taskGroups = new TaskGroups(this.grouping, tasksSortedLimited, searchInfo);

            if (this._taskGroupLimit !== undefined) {
                taskGroups.applyTaskLimit(this._taskGroupLimit);
            }

            return new QueryResult(taskGroups, tasksSorted.length);
        } catch (e) {
            const description = 'Search failed';
            let message = errorMessageForException(description, e);

            if (possiblyBrokenStatement) {
                message = Query.generateErrorMessage(possiblyBrokenStatement, message);
            }
            return QueryResult.fromError(message);
        }
    }

    private parseHideOptions(line: string): void {
        const hideOptionsMatch = line.match(this.hideOptionsRegexp);
        if (hideOptionsMatch === null) {
            return;
        }
        const hide = hideOptionsMatch[1].toLowerCase() === 'hide';
        const option = hideOptionsMatch[2].toLowerCase();

        if (parseQueryShowHideOptions(this._queryLayoutOptions, option, hide)) {
            return;
        }
        if (parseTaskShowHideOptions(this._taskLayoutOptions, option, !hide)) {
            return;
        }
        this.setError('do not understand hide/show option', new Statement(line, line));
    }

    private parseFilter(line: string, statement: Statement) {
        const filterOrError = FilterParser.parseFilter(line);
        if (filterOrError != null) {
            if (filterOrError.filter) {
                // Overwrite the filter's statement, to preserve details of any
                // continuation lines and placeholder expansions.
                filterOrError.filter.setStatement(statement);

                this._filters.push(filterOrError.filter);
            } else {
                this.setError(filterOrError.error ?? 'Unknown error', statement);
            }
            return true;
        }
        return false;
    }

    private parseLimit(line: string): void {
        const limitMatch = line.match(this.limitRegexp);
        if (limitMatch === null) {
            this.setError('do not understand query limit', new Statement(line, line));
            return;
        }

        // limitMatch[3] is per regex always digits and therefore parsable.
        const limitFromLine = Number.parseInt(limitMatch[3], 10);

        if (limitMatch[1] !== undefined) {
            this._taskGroupLimit = limitFromLine;
        } else {
            this._limit = limitFromLine;
        }
    }

    private parseSortBy(line: string, statement: Statement): boolean {
        const sortingMaybe = FilterParser.parseSorter(line);
        if (sortingMaybe) {
            sortingMaybe.setStatement(statement);
            this._sorting.push(sortingMaybe);
            return true;
        }
        return false;
    }

    /**
     * Parsing of `group by` lines, for grouping that is implemented in the {@link Field}
     * classes.
     *
     * @param line
     * @param statement
     * @private
     */
    private parseGroupBy(line: string, statement: Statement): boolean {
        const groupingMaybe = FilterParser.parseGrouper(line);
        if (groupingMaybe) {
            groupingMaybe.setStatement(statement);
            this._grouping.push(groupingMaybe);
            return true;
        }
        return false;
    }

    /**
     * Creates a unique ID for correlation of console logging.
     *
     * @private
     * @param {number} length
     * @return {*}  {string}
     */
    private generateQueryId(length: number): string {
        const chars = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890';
        const randomArray = Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]);

        const randomString = randomArray.join('');
        return randomString;
    }

    public debug(message: string, objects?: any): void {
        this.logger.debugWithId(this._queryId, `"${this.filePath}": ${message}`, objects);
    }
}
