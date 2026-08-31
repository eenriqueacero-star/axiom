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

# Benchmarks + risk-off proxy
BENCHMARKS = ["SPY", "QQQ"]
CASH_PROXY = "BIL"

UNIVERSE = sorted(set(HOLDINGS + DISCOVERY_POOL))  # kept for the biased run
