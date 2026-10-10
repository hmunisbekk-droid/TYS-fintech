"""Borrower archetypes for the Daromad synthetic population.

Every number here is a declared modelling assumption, not a measurement.
Income anchors are expressed relative to AVG_WAGE_UZS, which you should set
from the latest stat.uz wage press release (see docs/DATA_SOURCES.md) and
re-run the generator. Nothing in this file is derived from any real person.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Anchor: average monthly nominal wage in Uzbekistan (UZS). Update from stat.uz.
AVG_WAGE_UZS = 5_500_000

# Base calculation value (БРВ / BHM). Update from lex.uz when it changes.
BRV_UZS = 440_000


@dataclass
class Archetype:
    key: str
    label: str
    activity_uz: str               # as it appears on a Soliq self-employed certificate
    income_mult: float             # mean monthly business inflow / AVG_WAGE_UZS
    income_sigma: float            # lognormal sigma across borrowers of this type
    season_amp: float              # seasonal amplitude (0..1) of monthly revenue
    season_peak_month: int         # 1..12
    customers_per_month: float     # mean count of paying customers per month
    ticket_sigma: float            # lognormal sigma of ticket size
    pos_share: float               # share of revenue arriving via POS terminal
    p2p_share: float               # share arriving via card-to-card P2P from customers
    marketplace_share: float       # share arriving as marketplace payouts
    # remaining share is cash and never shows up in statements
    supplier_share: float          # share of revenue spent on suppliers/materials
    rent_share: float              # fixed monthly rent as share of mean revenue (0 if home-based)
    side_salary_prob: float        # probability of a salaried side job in the household
    relative_transfer_prob: float  # probability of recurring transfers from relatives
    existing_loan_prob: float      # probability of at least one existing loan
    shock_prob_per_month: float    # probability of a revenue shock in a given month
    weekly_pattern: list[float] = field(default_factory=lambda: [1.0] * 7)  # Mon..Sun multipliers


ARCHETYPES: list[Archetype] = [
    Archetype("tailor", "Home tailor", "Tikuvchilik xizmatlari", 0.85, 0.35, 0.35, 8, 28, 0.6,
              0.15, 0.55, 0.0, 0.30, 0.0, 0.35, 0.40, 0.35, 0.05),
    Archetype("hairdresser", "Hairdresser / barber", "Sartaroshlik xizmatlari", 1.05, 0.30, 0.15, 3, 95, 0.4,
              0.35, 0.45, 0.0, 0.12, 0.18, 0.25, 0.25, 0.40, 0.04,
              [0.8, 0.9, 1.0, 1.0, 1.2, 1.5, 1.1]),
    Archetype("taxi", "Taxi driver (app-based)", "Yo'lovchi tashish xizmatlari", 1.15, 0.30, 0.10, 12, 180, 0.5,
              0.05, 0.10, 0.70, 0.35, 0.0, 0.15, 0.20, 0.55, 0.06,
              [1.0, 1.0, 1.0, 1.0, 1.2, 1.3, 0.9]),
    Archetype("dehkan", "Dehkan farmer (seasonal produce)", "Dehqon xo'jaligi mahsulotlari", 1.30, 0.45, 0.75, 8, 22, 0.9,
              0.10, 0.60, 0.0, 0.40, 0.0, 0.30, 0.45, 0.45, 0.08),
    Archetype("grocer", "Small grocery shop", "Chakana savdo", 2.20, 0.35, 0.12, 12, 520, 0.7,
              0.65, 0.20, 0.0, 0.70, 0.12, 0.15, 0.15, 0.55, 0.04),
    Archetype("reseller", "Telegram reseller (clothes, cosmetics)", "Onlayn savdo", 1.40, 0.45, 0.30, 11, 60, 0.7,
              0.05, 0.80, 0.10, 0.60, 0.0, 0.30, 0.30, 0.35, 0.07),
    Archetype("tutor", "Private tutor", "Repetitorlik xizmatlari", 0.95, 0.30, 0.45, 10, 18, 0.3,
              0.05, 0.85, 0.0, 0.05, 0.0, 0.45, 0.30, 0.25, 0.03,
              [1.1, 1.1, 1.1, 1.1, 1.0, 0.8, 0.5]),
    Archetype("plumber", "Plumber / electrician", "Santexnik va elektrik xizmatlari", 1.20, 0.40, 0.20, 7, 24, 0.8,
              0.05, 0.75, 0.0, 0.25, 0.0, 0.30, 0.25, 0.40, 0.06),
    Archetype("bakery", "Home bakery", "Non va qandolat mahsulotlari", 1.10, 0.35, 0.25, 3, 140, 0.5,
              0.30, 0.50, 0.0, 0.45, 0.05, 0.30, 0.35, 0.40, 0.05,
              [1.0, 1.0, 1.0, 1.0, 1.2, 1.4, 1.3]),
    Archetype("phone_repair", "Phone repair kiosk", "Mobil telefonlarni ta'mirlash", 1.35, 0.35, 0.10, 9, 70, 0.6,
              0.45, 0.45, 0.0, 0.40, 0.20, 0.20, 0.20, 0.45, 0.04),
]

ARCHETYPE_BY_KEY = {a.key: a for a in ARCHETYPES}

# Public merchant / counterparty lexicon (business names are public information).
SUPERMARKETS = ["KORZINKA", "MAKRO", "HAVAS", "BARAKA MARKET", "ANGLESEY", "MAGNUM"]
FUEL = ["UNG PETRO", "UZGASOIL", "PETROL AZS"]
TAXI_APPS = ["YANDEX GO", "MYTAXI"]
TELECOM = ["BEELINE UZ", "UCELL", "MOBIUZ", "UZMOBILE", "UZTELECOM"]
UTILITIES = ["HUDUDIY ELEKTR TARMOQLARI", "TOSHKENT ISSIQLIK", "SUVSOZ", "HUDUDGAZTAMINOT"]
MARKETPLACES = ["UZUM MARKET", "YANDEX GO PARTNER", "OLX"]
BANKS = ["MKBANK", "XALQ BANKI", "AGROBANK", "IPOTEKA BANK", "KAPITALBANK", "HAMKORBANK", "SQB", "TBC BANK"]
WALLETS = ["PAYME", "CLICK", "UZUM BANK", "PAYNET"]
SUPPLIER_WORDS = ["OPTOM", "TEXTIL", "MATO", "ULGURJI", "SAVDO", "IMPORT", "DISTRIBUTION"]

FIRST_NAMES = ["Dilnoza", "Aziz", "Malika", "Jasur", "Nilufar", "Bekzod", "Gulnora", "Sardor", "Zilola", "Otabek",
               "Madina", "Umid", "Shahnoza", "Farrux", "Nodira", "Rustam", "Sevara", "Jahongir", "Kamola", "Sherzod"]
FEMALE_FIRST_NAMES = {"Dilnoza", "Malika", "Nilufar", "Gulnora", "Zilola", "Madina", "Shahnoza", "Nodira", "Sevara", "Kamola"}
# surnames are listed in a mixed form on purpose (keeps the random draws identical); gender_surname() fixes the ending
LAST_NAMES = ["Karimova", "Tursunov", "Rahimova", "Yusupov", "Abdullayeva", "Ismoilov", "Saidova", "Mirzayev",
              "Xolmatova", "Nazarov", "Qodirova", "Ergashev", "Toshmatova", "Berdiyev", "Olimova", "Xasanov"]


def gender_surname(first: str, last: str) -> str:
    """Uzbek surnames of the -ov/-ev type take -a for women: Ismoilov → Ismoilova; Karimova → Karimov for men."""
    female = first in FEMALE_FIRST_NAMES
    if female and (last.endswith("ov") or last.endswith("ev")):
        return last + "a"
    if not female and (last.endswith("ova") or last.endswith("eva")):
        return last[:-1]
    return last

REGIONS = ["Toshkent sh.", "Samarqand", "Farg'ona", "Andijon", "Namangan", "Qashqadaryo", "Buxoro", "Surxondaryo",
           "Xorazm", "Jizzax", "Navoiy", "Sirdaryo", "Toshkent vil.", "Qoraqalpog'iston"]
