"""Ticker universe — mirrors server/agents/definitions.js."""

HOLDINGS = ["NVDA", "NBIS", "MU", "AMD", "SNDK", "CRDO", "APLD", "ALAB", "FLY"]

DISCOVERY_POOL = [
    "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "SMCI", "ARM", "MRVL", "AVGO",
    "TSM", "ASML", "LRCX", "KLAC", "SNOW", "NET", "DDOG", "PANW", "COIN", "MSTR",
    "RKLB", "IONQ", "RGTI", "QBTS", "LLY", "ISRG", "DXCM", "ENPH", "FSLR", "CEG",
]

# Full tradeable universe for rotation strategies.
UNIVERSE = sorted(set(HOLDINGS + DISCOVERY_POOL))

BENCHMARKS = ["SPY", "QQQ"]
CASH_PROXY = "BIL"  # 1-3 month T-bill ETF; stand-in for "risk-off"
