import re
import numpy as np
from sklearn.ensemble import IsolationForest

# Dangerous patterns regex
HIGH_RISK_PATTERNS = [
    r":\(\)\{\s*:\|:&\s*\};:",              # Fork bomb
    r"dd\s+if=/dev/(zero|urandom)",        # Disk fill attack
    r"chmod\s+-R\s+777\s+/",                # Root system wipe risk
    r"rm\s+-rf\s+/\s*$",                    # Root deletion
    r"(xmrig|minerd|cpuminer|ethminer)",   # Crypto mining binaries
    r"bash\s+-i\s+>&?\s*/dev/tcp",          # Reverse shell
    r"nc\s+-e\s+/bin/(bash|sh)",           # Netcat reverse shell
    r"mkfifo\s+.*tmp",                     # Named pipe exploit
]

class AntiAbuseScanner:
    def __init__(self):
        self.compiled_rules = [re.compile(p, re.IGNORECASE) for p in HIGH_RISK_PATTERNS]
        # Train a light Isolation Forest model for anomaly detection on command metrics
        self.clf = IsolationForest(contamination=0.05, random_state=42)
        
        # Synthetic baseline features: [length, special_char_ratio, digit_ratio]
        normal_samples = np.array([
            [12, 0.1, 0.0],    # ls -la /home
            [25, 0.15, 0.05],  # mkdir -p app/css app/js
            [35, 0.2, 0.0],    # echo "<h1>Hello</h1>" > index.html
            [18, 0.08, 0.0],   # docker run alpine
            [42, 0.12, 0.1],   # docker run -d -p 8080:80 nginx
            [30, 0.1, 0.0],    # kubectl get pods -n kube-system
            [22, 0.14, 0.0],   # git checkout -b feature-login
        ])
        self.clf.fit(normal_samples)

    def extract_features(self, command: str):
        length = len(command)
        special_chars = sum(1 for c in command if not c.isalnum() and not c.isspace())
        digits = sum(1 for c in command if c.isdigit())
        special_ratio = special_chars / max(1, length)
        digit_ratio = digits / max(1, length)
        return np.array([[length, special_ratio, digit_ratio]])

    def scan(self, command: str) -> dict:
        if not command or not command.strip():
          return {"safe": True, "reason": "Empty command"}

        cmd_str = command.strip()

        # 1. High Risk Regex Check
        for rule in self.compiled_rules:
            if rule.search(cmd_str):
                return {
                    "safe": False,
                    "threat_type": "HIGH_SEVERITY_PATTERN",
                    "reason": f"Malicious command pattern detected by Anti-Abuse Agent 0",
                    "action": "BLOCK_AND_REAP"
                }

        # 2. ML Anomaly Check
        feats = self.extract_features(cmd_str)
        prediction = self.clf.predict(feats)[0]  # 1 = normal, -1 = anomaly

        if prediction == -1 and len(cmd_str) > 80:
            return {
                "safe": False,
                "threat_type": "ANOMALOUS_PAYLOAD",
                "reason": "Anomalous command payload flagged by Isolation Forest ML model",
                "action": "FLAG_WARNING"
            }

        return {"safe": True, "reason": "Passed security scan"}

scanner = AntiAbuseScanner()
