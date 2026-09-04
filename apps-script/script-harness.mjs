import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const codePath = path.join(root, "apps-script", "Code.gs")
export const codeSource = fs.readFileSync(codePath, "utf8")

/** A conditional format rule as SpreadsheetApp hands one back. */
function builtRule(formula, background, ranges) {
  return {
    getBooleanCondition: () => ({
      getCriteriaValues: () => [formula],
    }),
    getRanges: () => ranges,
    getBackground: () => background,
  }
}

export function foreignRule(formula) {
  return builtRule(formula, "#D9EAD3", [])
}

/** A rule with no boolean condition, e.g. a colour scale. */
export function gradientRule() {
  return {
    getBooleanCondition: () => null,
    getRanges: () => [],
  }
}

export function fakeSheet(options = {}) {
  const sheet = {
    calls: [],
    rules: options.rules ? options.rules.slice() : [],
    maxColumns: options.maxColumns ?? 26,
    lastRow: options.lastRow ?? 100,
    hiddenRows: new Set(options.hiddenRows ?? []),
    filtered: options.filtered ?? false,
    values: options.values ?? {},
    formulas: options.formulas ?? {},

    getSheetId: () => 1,
    getName: () => "Sheet1",
    getMaxColumns: () => sheet.maxColumns,
    getLastRow: () => sheet.lastRow,
    getFilter: () => (sheet.filtered ? {} : null),

    isRowHiddenByFilter(row) {
      sheet.calls.push("isRowHiddenByFilter:" + row)
      return sheet.hiddenRows.has(row)
    },

    getConditionalFormatRules() {
      sheet.calls.push("getConditionalFormatRules")
      return sheet.rules.slice()
    },

    setConditionalFormatRules(next) {
      sheet.calls.push("setConditionalFormatRules")
      sheet.rules = next.slice()
    },

    getRange(...args) {
      const a1 = args.length === 1 ? String(args[0]) : args.join(",")
      sheet.calls.push("getRange:" + a1)
      return makeRange(sheet, a1, args)
    },

    getActiveRange: () => options.activeRange ?? null,
    setActiveRange(range) {
      sheet.calls.push("setActiveRange:" + range.a1)
    },
  }
  return sheet
}

function makeRange(sheet, a1, args) {
  const [row, column, numRows, numColumns] = args.length === 4 ? args : []
  const key = `${row},${column},${numRows},${numColumns}`
  return {
    a1,
    getRow: () => row,
    getColumn: () => column,
    getNumRows: () => numRows,
    getNumColumns: () => numColumns,
    getValues() {
      sheet.calls.push("getValues:" + key)
      return sheet.values[key] ?? blank(numRows)
    },
    getFormulas() {
      sheet.calls.push("getFormulas:" + key)
      return sheet.formulas[key] ?? blank(numRows)
    },
    setValues(next) {
      sheet.calls.push("setValues:" + key)
      sheet.values[key] = next
    },
    offset: (r, c, rows, cols) =>
      makeRange(sheet, a1, [row + r, column + c, rows ?? numRows, cols ?? numColumns]),
  }
}

function blank(rows) {
  return Array.from({ length: rows ?? 0 }, () => [""])
}

export function selectionOf(row, column, numRows = 1, numColumns = 1) {
  return {
    getRow: () => row,
    getColumn: () => column,
    getNumRows: () => numRows,
    getNumColumns: () => numColumns,
  }
}

/** Load Code.gs with stand-ins for the services a bound script gets. */
export function loadScript(overrides = {}) {
  const alerts = []
  const prompts = []
  const store = new Map()
  const cache = new Map()

  const sandbox = {
    console,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Date,
    alerts,
    prompts,
    store,
    cache,

    SpreadsheetApp: {
      newConditionalFormatRule() {
        let formula = null
        let background = null
        let ranges = []
        const api = {
          whenFormulaSatisfied(value) {
            formula = value
            return api
          },
          setBackground(value) {
            background = value
            return api
          },
          setRanges(value) {
            ranges = value
            return api
          },
          build: () => builtRule(formula, background, ranges),
        }
        return api
      },
      getActiveSpreadsheet: () => overrides.spreadsheet ?? {},
      getUi: () => ({
        ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL" },
        Button: { OK: "OK" },
        alert(...args) {
          alerts.push(args)
        },
        prompt(...args) {
          prompts.push(args)
          return (
            overrides.promptResponse ?? {
              getSelectedButton: () => "OK",
              getResponseText: () => "",
            }
          )
        },
        createMenu: () => {
          const menu = {
            addItem: () => menu,
            addSeparator: () => menu,
            addToUi: () => menu,
          }
          return menu
        },
      }),
    },

    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => cache.set(key, value),
        remove: (key) => cache.delete(key),
      }),
    },

    PropertiesService: {
      getDocumentProperties: () => ({
        getProperty: (key) => (store.has(key) ? store.get(key) : null),
        setProperty: (key, value) => store.set(key, value),
        deleteProperty: (key) => store.delete(key),
      }),
    },
  }

  vm.runInNewContext(codeSource, sandbox, { filename: codePath })
  return sandbox
}
