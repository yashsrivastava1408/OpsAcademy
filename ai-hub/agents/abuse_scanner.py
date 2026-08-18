import re
import base64
import urllib.parse
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
    r"eval\s*\(\s*base64_decode",          # Obfuscated PHP/python execution
]

class AntiAbuseScanner:
    def __init__(self):
        self.compiled_rules = [re.compile(p, re.IGNORECASE) for p in HIGH_RISK_PATTERNS]
        # Train Isolation Forest model for anomaly detection on command metrics
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

    def decode_obfuscated(self, command: str) -> str:
        """
        De-obfuscate base64 strings, URL encodings, and hex encoded payloads
        """
        decoded_text = command

        # 1. Check for Base64 pattern (e.g. echo "..." | base64 -d)
        b64_matches = re.findall(r'(?:[A-Za-z0-9+/]{4}){3,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?', command)
        for b64_str in b64_matches:
          if len(b64_str) > 12:
            try:
              decoded_bytes = base64.b64decode(b64_str)
              decoded_str = decoded_bytes.decode('utf-8', errors='ignore')
              if any(k in decoded_str for k in ['bash', 'sh', 'nc', 'rm', 'curl', 'wget', 'chmod']):
                decoded_text += f" {decoded_str}"
            except Exception:
              pass

        # 2. Check for URL encoding
        try:
          unquoted = urllib.parse.unquote(command)
          if unquoted != command:
            decoded_text += f" {unquoted}"
        except Exception:
          pass

        return decoded_text

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

        cmd_raw = command.strip()
        deobfuscated_cmd = self.decode_obfuscated(cmd_raw)

        # 1. High Risk Regex Check on raw and deobfuscated payload
        for rule in self.compiled_rules:
            if rule.search(cmd_raw) or rule.search(deobfuscated_cmd):
                return {
                    "safe": False,
                    "threat_type": "HIGH_SEVERITY_PATTERN",
                    "reason": "Malicious command or obfuscated payload pattern detected by Anti-Abuse Agent 0",
                    "action": "BLOCK_AND_REAP",
                    "deobfuscated": deobfuscated_cmd != cmd_raw
                }

        # 2. ML Anomaly Check
        feats = self.extract_features(cmd_raw)
        prediction = self.clf.predict(feats)[0]  # 1 = normal, -1 = anomaly

        if prediction == -1 and len(cmd_raw) > 80:
            return {
                "safe": False,
                "threat_type": "ANOMALOUS_PAYLOAD",
                "reason": "Anomalous command payload flagged by Isolation Forest ML model",
                "action": "FLAG_WARNING"
            }

        return {"safe": True, "reason": "Passed security scan"}

scanner = AntiAbuseScanner()
