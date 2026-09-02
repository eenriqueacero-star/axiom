"""Ticker universes for backtests."""

# The user's actual concentrated portfolio (server/agents/definitions.js).
HOLDINGS = ["NVDA", "NBIS", "MU", "AMD", "SNDK", "CRDO", "APLD", "ALAB", "FLY"]

DISCOVERY_POOL = [
    "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "SMCI", "ARM", "MRVL", "AVGO",
    "TSM", "ASML", "LRCX", "KLAC", "SNOW", "NET", "DDOG", "PANW", "COIN", "MSTR",
    "RKLB", "IONQ", "RGTI", "QBTS", "LLY", "ISRG", "DXCM", "ENPH", "FSLR", "CEG",
]

# ~120 large-cap US names that all traded before 2009 — a fair, survivorship-light
# universe for a 2010-2025 test spanning the 2011 / 2015-16 / 2018 / 2020 / 2022
# drawdowns. Tech-tilted (matches the user's interest) but diversified so a
# rotation strategy has somewhere to rotate.
LIQUID_120 = sorted(set([
    # mega-cap tech / semis
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "INTC", "CSCO", "ORCL", "IBM", "QCOM",
    "TXN", "ADBE", "CRM", "AMD", "MU", "AMAT", "LRCX", "KLAC", "ADI", "ADSK",
    "INTU", "ACN", "NFLX", "MCHP", "SWKS", "NTAP", "STX", "WDC", "HPQ", "GLW",
    # consumer discretionary / retail
    "HD", "LOW", "NKE", "SBUX", "MCD", "TGT", "COST", "WMT", "DIS", "TJX",
    "ROST", "YUM", "DG", "DLTR", "BKNG", "MAR", "GPC", "ORLY", "AZO", "GRMN",
    # healthcare
    "UNH", "JNJ", "LLY", "MRK", "PFE", "TMO", "ABT", "DHR", "ISRG", "VRTX",
    "REGN", "AMGN", "GILD", "BMY", "MDT", "SYK", "BSX", "HUM", "CI", "BDX",
    # financials
    "JPM", "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "AXP", "C", "V",
    "MA", "SPGI", "ICE", "CME", "USB", "PNC", "TROW", "AON", "MMC", "AFL",
    # industrials
    "BA", "CAT", "DE", "HON", "GE", "UPS", "LMT", "UNP", "CSX", "NSC",
    "MMM", "EMR", "ETN", "PH", "ITW", "GD", "NOC", "ROP", "PCAR", "FDX",
    # energy / materials / staples / utilities
    "XOM", "CVX", "COP", "SLB", "EOG", "PXD", "MPC", "PSX", "APD", "SHW",
    "FCX", "NEM", "NUE", "PG", "KO", "PEP", "CL", "MO", "PM", "KMB",
    "MDLZ", "GIS", "T", "VZ", "CMCSA", "NEE", "DUK", "SO", "D", "AEP",
]))

# --- The Axiom rulebook (server/lib/strategy.js) ---

# §1/§7 Core sleeve — quality compounders held for years. (Tiingo wants BRK-B.)
CORE_LIST = ["MSFT", "GOOGL", "META", "AMZN", "COST", "V", "MA", "LLY", "UNH", "ISRG", "JPM", "BRK-B"]

# Satellite sleeve — the growth / AI / semis pool the momentum sleeve rotates in.
SATELLITE_POOL = sorted(set([
    "NVDA", "AMD", "MU", "AVGO", "TSM", "ASML", "LRCX", "KLAC", "AMAT", "MRVL", "ARM", "SMCI",
    "TSLA", "AAPL", "NFLX", "CRM", "NOW", "SNOW", "NET", "DDOG", "PANW", "CRWD", "PLTR",
    "COIN", "MSTR", "SHOP", "UBER", "ABNB", "AXON", "VRT", "ANET", "CEG",
]))

SPLIT_CORE = 0.50            # §1 Core/Satellite target
SECTOR_CAP = 0.35            # §3
NAME_CAP_SATELLITE = 0.08    # §3
ENTRY_MA_DAYS = 200         # §4 must be above the 200-day to hold/add

# Benchmarks + risk-off proxy
BENCHMARKS = ["SPY", "QQQ"]
CASH_PROXY = "BIL"

AXIOM_UNIVERSE = sorted(set(CORE_LIST + SATELLITE_POOL + BENCHMARKS + [CASH_PROXY]))

UNIVERSE = sorted(set(HOLDINGS + DISCOVERY_POOL))  # kept for the biased run
