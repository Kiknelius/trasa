"""The story (original). Each line: (text, planned start in s, edge-tts rate, pitch, style tag)."""
TITLE = "Never Count the People in the Mirror"
LINES = [
    ("My grandma had one rule.",               0.25, "-8%",  "-6Hz",  ""),
    ("Never count the people in the mirror.",  1.9,  "-10%", "-6Hz",  ""),
    ("Last night, the power went out...",      4.9,  "-8%",  "-6Hz",  ""),
    ("and I broke it.",                        7.3,  "-10%", "-8Hz",  ""),
    ("One.",                                   9.6,  "-15%", "-6Hz",  ""),
    ("Just me.",                               10.5, "-10%", "-6Hz",  ""),
    ("The candle flickered.",                  11.9, "-10%", "-6Hz",  ""),
    ("Two.",                                   14.0, "-15%", "-8Hz",  ""),
    ("I turned around.",                       15.4, "-5%",  "-6Hz",  ""),
    ("Nobody there.",                          17.6, "-10%", "-6Hz",  ""),
    ("I looked back.",                         19.3, "-8%",  "-6Hz",  ""),
    ("Three.",                                 21.0, "-15%", "-10Hz", ""),
    ("They were closer now.",                  22.3, "-12%", "-8Hz",  ""),
    ("I raised my hand.",                      24.6, "-8%",  "-6Hz",  ""),
    ("My reflection didn't.",                  26.0, "-12%", "-8Hz",  ""),
    ("It just...",                             27.9, "-15%", "-8Hz",  ""),
    ("smiled.",                                29.4, "-20%", "-12Hz", ""),
    ("Then the candle went out.",              31.0, "-10%", "-8Hz",  ""),
    ("When the light came back,",              34.6, "-8%",  "-6Hz",  ""),
    ("I was on the wrong side of the glass.",  36.3, "-10%", "-8Hz",  ""),
    ("And the thing wearing my face",          39.3, "-12%", "-10Hz", ""),
    ("picked up the candle...",                41.2, "-12%", "-10Hz", ""),
    ("and started counting.",                  43.2, "-15%", "-12Hz", ""),
    ("One.",                                   45.6, "-30%", "-20Hz", "whisper"),
]
END_PAD = 1.4          # seconds after the last word (black frame, loops back to the start)
