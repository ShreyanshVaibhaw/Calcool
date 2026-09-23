// UI strings. All component copy lives here in the `en` table; a second locale
// is data only: addLocale("de", {...}) with the same shape, no component edits.
// Dynamic copy uses functions so translators control word order.

export interface AppStrings {
  hideSidebar: string;
  showSidebar: string;
  searchSheets: string;
  newSheet: string;
  noMatchingSheets: string;
  noSheetsYet: string;
  doubleClickToRename: string;
  deleteSheet: string;
  inbox: string;
  newSheetIn: (folder: string) => string;
  deleteFolder: (folder: string) => string;
  exportFormat: string;
  exportActive: string;
  exportButton: string;
  printButton: string;
  printTitle: string;
  importButton: string;
  importTitle: string;
  newFolder: string;
  newFolderTitle: string;
  samplesButton: string;
  samplesTitle: string;
  shortcutsButton: string;
  shortcutsTitle: string;
  settingsButton: string;
  settingsTitle: string;
  deleteSheetConfirm: (name: string) => string;
  folderNamePrompt: string;
  deleteFolderConfirm: (name: string) => string;
  totalModeTitle: (mode: string) => string;
  copyTotalTitle: string;
  copied: string;
  yesterday: string;
}

export interface SettingsStrings {
  title: string;
  subtitle: string;
  close: string;
  theme: string;
  calculation: string;
  workdayHolidays: string;
  regionAuto: string;
  regionUS: string;
  regionUK: string;
  regionIN: string;
  hoursPerWorkday: string;
  cupSize: string;
  cupUS: string;
  cupMetric: string;
  cupImperial: string;
  numberFormat: string;
  numRegionEn: string;
  numRegionDe: string;
  numRegionFr: string;
  decimals: string;
  fontSize: string;
  fontChoice: string;
  taxWord: string;
  taxWordPlaceholder: string;
  taxRate: string;
  taxHint: (name: string) => string;
  hotkey: string;
  hotkeyAuto: string;
  hotkeyActive: (accel: string) => string;
  hotkeyNone: string;
  hotkeyInstalledOnly: string;
  sheetsLocation: string;
  openSheetsFolder: string;
  syncFolder: string;
  syncPlaceholder: string;
  syncHint: string;
  updatesTitle: string;
  appVersion: (version: string) => string;
  updateProgress: string;
  checkUpdates: string;
  checking: string;
  downloading: string;
  downloadingPct: (pct: number) => string;
  installing: string;
  installVersion: (version: string) => string;
}

export interface UpdaterStrings {
  idle: string;
  browserOnly: string;
  checking: string;
  current: string;
  ready: (version: string, body: string | undefined) => string;
  downloading: (version: string) => string;
  installing: string;
  checkFailed: (error: string) => string;
  installFailed: (error: string) => string;
}

export interface QuickStrings {
  placeholder: string;
  copiesHint: string;
}

export interface ShortcutsStrings {
  title: string;
  subtitle: string;
  close: string;
  groups: { title: string; rows: [string, string][] }[];
}

export interface Strings {
  app: AppStrings;
  settings: SettingsStrings;
  updater: UpdaterStrings;
  quick: QuickStrings;
  shortcuts: ShortcutsStrings;
}

const en: Strings = {
  app: {
    hideSidebar: "Hide sidebar (Ctrl+\\)",
    showSidebar: "Show sheets (Ctrl+\\)",
    searchSheets: "Search sheets",
    newSheet: "New sheet (Ctrl+N)",
    noMatchingSheets: "No matching sheets",
    noSheetsYet: "No sheets yet",
    doubleClickToRename: "Double-click to rename",
    deleteSheet: "Delete sheet",
    inbox: "Inbox",
    newSheetIn: (folder) => `New sheet in ${folder}`,
    deleteFolder: (folder) => `Delete folder ${folder}`,
    exportFormat: "Export format",
    exportActive: "Export the active sheet",
    exportButton: "Export",
    printButton: "Print",
    printTitle: "Print the active sheet (PDF via your printer)",
    importButton: "Import",
    importTitle: "Import .txt, .calcool, .slvr files",
    newFolder: "+ Folder",
    newFolderTitle: "New folder",
    samplesButton: "Samples",
    samplesTitle: "Add the household budget and trip conversion samples",
    shortcutsButton: "Shortcuts",
    shortcutsTitle: "Keyboard shortcuts",
    settingsButton: "Appearance & updates",
    settingsTitle: "Appearance & updates (Ctrl+,)",
    deleteSheetConfirm: (name) => `Delete "${name}"?`,
    folderNamePrompt: "Folder name",
    deleteFolderConfirm: (name) => `Delete folder "${name}"? Its sheets move to Inbox.`,
    totalModeTitle: (mode) => `Total mode: ${mode} — click to switch`,
    copyTotalTitle: "Click to copy",
    copied: "copied",
    yesterday: "Yesterday",
  },
  settings: {
    title: "Appearance & updates",
    subtitle: "Personalize Calcool and keep it current.",
    close: "Close settings",
    theme: "Theme",
    calculation: "Calculation",
    workdayHolidays: "Workday holidays",
    regionAuto: "Auto (OS locale)",
    regionUS: "United States",
    regionUK: "United Kingdom",
    regionIN: "India",
    hoursPerWorkday: "Hours per workday",
    cupSize: "Cup size",
    cupUS: "US (236.6 mL)",
    cupMetric: "Metric (250 mL)",
    cupImperial: "Imperial (284.1 mL)",
    numberFormat: "Number format",
    numRegionEn: "1,000.50",
    numRegionDe: "1.000,50",
    numRegionFr: "1 000,50",
    decimals: "Decimals",
    fontSize: "Font size",
    fontChoice: "Font",
    taxWord: "Sales-tax word",
    taxWordPlaceholder: "VAT",
    taxRate: "Sales-tax rate %",
    taxHint: (name) => `"$300 + ${name}", "${name} on $300", and "- ${name}" divides included tax back out.`,
    hotkey: "Quick popup hotkey",
    hotkeyAuto: "Auto (first available)",
    hotkeyActive: (accel) => `Active: ${accel}`,
    hotkeyNone: "No hotkey could be registered",
    hotkeyInstalledOnly: "Applies in the installed app",
    sheetsLocation: "Sheets live in Documents\\Calcool",
    openSheetsFolder: "Open sheets folder",
    syncFolder: "Sync folder (optional)",
    syncPlaceholder: "e.g. C:\\Users\\me\\OneDrive\\Calcool",
    syncHint: "Each save mirrors every sheet there as a text file. Last write wins; Documents\\Calcool stays the source of truth.",
    updatesTitle: "App updates",
    appVersion: (version) => `Calcool ${version}`,
    updateProgress: "Update download progress",
    checkUpdates: "Check for updates",
    checking: "Checking...",
    downloading: "Downloading...",
    downloadingPct: (pct) => `Downloading ${pct}%`,
    installing: "Installing...",
    installVersion: (version) => `Install ${version}`,
  },
  updater: {
    idle: "Check GitHub for a newer signed release.",
    browserOnly: "Update checks are available in the installed app.",
    checking: "Checking GitHub releases...",
    current: "Calcool is up to date.",
    ready: (version, body) => body?.trim() || `Calcool ${version} is ready to install.`,
    downloading: (version) => `Downloading Calcool ${version}...`,
    installing: "Installing update and restarting...",
    checkFailed: (error) => `Could not check for updates. ${error}`,
    installFailed: (error) => `Update failed. ${error}`,
  },
  quick: {
    placeholder: "Type a calculation…",
    copiesHint: "↵ copies",
  },
  shortcuts: {
    title: "Keyboard shortcuts",
    subtitle: "Every shortcut in Calcool, in one place.",
    close: "Close shortcuts",
    groups: [
      {
        title: "Find and navigate",
        rows: [
          ["Ctrl+F", "Find in this sheet"],
          ["Ctrl+H", "Find and replace"],
          ["Ctrl+G", "Go to line"],
          ["Esc", "Close the find panel or dialog"],
        ],
      },
      {
        title: "Edit lines",
        rows: [
          ["Ctrl+D", "Duplicate the selected lines"],
          ["Ctrl+/", "Comment the selected lines"],
          ["Ctrl+T", "Insert a total line below"],
          ["Ctrl+Space", "Autocomplete a variable or unit"],
          ["Alt+drag / Alt+scroll", "Scrub the number under the cursor"],
          ["Ctrl+Z / Ctrl+Y", "Undo / redo (one drag is one undo)"],
        ],
      },
      {
        title: "Variables and references",
        rows: [
          ["F2 or Ctrl+R", "Rename the variable under the cursor everywhere"],
          ["Ctrl+L", "Insert a live reference to a line number"],
          ["Ctrl+\\", "Insert a reference to the nearest answer above"],
          ["Double-click an answer", "Insert a reference to it (drag works too)"],
          ["Type an operator on an empty line", "References the previous answer"],
        ],
      },
      {
        title: "Sheets and app",
        rows: [
          ["Ctrl+N", "New sheet"],
          ["Ctrl+\\", "Show or hide the sheet sidebar"],
          ["Ctrl+,", "Open settings"],
          ["Double-click a sheet title", "Rename it (empty reverts to auto)"],
        ],
      },
      {
        title: "Quick popup",
        rows: [
          ["Alt+Space", "Open the quick calculator (falls back when a launcher owns it)"],
          ["Enter", "Copy the answer and close"],
          ["Esc", "Close without copying"],
        ],
      },
    ],
  },
};

export type LocaleId = "en";

const tables: Record<string, Strings> = { en };
let current: LocaleId = "en";

// Second locales plug in here; components keep reading `s` untouched.
export function addLocale(id: string, table: Strings): void {
  tables[id] = table;
}

export function setLocale(id: string): void {
  if (tables[id]) current = id as LocaleId;
}

// Live lookup so a later setLocale takes effect without touching components.
export const s: Strings = new Proxy({} as Strings, {
  get: (_target, key: string) => (tables[current] as unknown as Record<string, unknown>)[key],
});
