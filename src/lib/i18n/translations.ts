export type Language = "en" | "sw";

export const LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "sw", label: "Swahili", nativeLabel: "Kiswahili" },
];

/**
 * A focused, hand-translated set of strings covering navigation and the most
 * visible screens (Home, Settings, Account). This is real, working i18n
 * infrastructure — extending coverage to the rest of the app just means
 * adding more keys here and swapping the literal string for `t("key")` at
 * each call site, following the same pattern.
 */
export const translations = {
  en: {
    nav_home: "Home",
    nav_sellers: "Sellers",
    nav_tracking: "Tracking",
    nav_overview: "Overview",
    nav_orders: "Orders",
    nav_payouts: "Payouts",
    nav_disputes: "Disputes",
    nav_more: "More",
    nav_requests: "Requests",
    nav_settings: "Settings",
    nav_help: "Help",
    nav_account: "Account",

    home_greeting: "Hi",
    home_protected_in_escrow: "Protected in Escrow",
    home_active_orders: "Active Orders",
    home_recent_transactions: "Recent Transactions",
    home_see_all: "See all",
    home_trust_score: "Trust Score",
    home_active: "Active",
    home_completed: "Completed",

    settings_title: "Settings",
    settings_security: "Security",
    settings_payments: "Payments",
    settings_preferences: "Preferences",
    settings_biometric_login: "Biometric login",
    settings_hide_balances: "Hide balances",
    settings_change_password: "Change password",
    settings_two_factor: "Two-factor authentication",
    settings_push_notifications: "Push notifications",
    settings_dark_mode: "Dark mode",
    settings_language: "Language",

    account_title: "Account",
    account_log_out: "Log out",
    account_deals: "Deals",
    account_completed: "Completed",

    common_save: "Save",
    common_cancel: "Cancel",
    common_back: "Back",
  },
  sw: {
    nav_home: "Nyumbani",
    nav_sellers: "Wauzaji",
    nav_tracking: "Ufuatiliaji",
    nav_overview: "Muhtasari",
    nav_orders: "Maagizo",
    nav_payouts: "Malipo",
    nav_disputes: "Migogoro",
    nav_more: "Zaidi",
    nav_requests: "Maombi",
    nav_settings: "Mipangilio",
    nav_help: "Msaada",
    nav_account: "Akaunti",

    home_greeting: "Habari",
    home_protected_in_escrow: "Imelindwa kwenye Escrow",
    home_active_orders: "Maagizo Yanayoendelea",
    home_recent_transactions: "Miamala ya Hivi Karibuni",
    home_see_all: "Ona yote",
    home_trust_score: "Alama za Uaminifu",
    home_active: "Yanayoendelea",
    home_completed: "Yaliyokamilika",

    settings_title: "Mipangilio",
    settings_security: "Usalama",
    settings_payments: "Malipo",
    settings_preferences: "Mapendeleo",
    settings_biometric_login: "Kuingia kwa alama za kibiolojia",
    settings_hide_balances: "Ficha salio",
    settings_change_password: "Badilisha nenosiri",
    settings_two_factor: "Uthibitishaji wa hatua mbili",
    settings_push_notifications: "Arifa",
    settings_dark_mode: "Hali ya giza",
    settings_language: "Lugha",

    account_title: "Akaunti",
    account_log_out: "Toka",
    account_deals: "Mikataba",
    account_completed: "Iliyokamilika",

    common_save: "Hifadhi",
    common_cancel: "Ghairi",
    common_back: "Rudi",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type TranslationKey = keyof (typeof translations)["en"];
