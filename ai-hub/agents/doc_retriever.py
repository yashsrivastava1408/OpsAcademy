import re
import math

DOC_KNOWLEDGE_BASE = [
    {
        "topic": "linux_permissions",
        "keywords": ["chmod", "permission", "denied", "rwx", "755", "644", "chown", "sudo"],
        "content": "Linux file permissions consist of Owner, Group, and Others. Use 'chmod +x script.sh' to make a file executable. 755 means owner=rwx, group=r-x, others=r-x."
    },
    {
        "topic": "linux_navigation",
        "keywords": ["mkdir", "touch", "ls", "cd", "pwd", "directory", "file", "find", "grep"],
        "content": "Use 'pwd' to print current working directory. Use 'mkdir -p a/b/c' to create nested directories. Use 'ls -la' to show hidden files."
    },
    {
        "topic": "docker_containers",
        "keywords": ["docker", "run", "container", "image", "pull", "ps", "port", "detach", "exec"],
        "content": "Docker containers share the host OS kernel. 'docker run -d -p 8080:80 nginx' runs Nginx in detached mode mapping host port 8080 to container port 80."
    },
    {
        "topic": "dockerfile",
        "keywords": ["dockerfile", "build", "copy", "cmd", "run", "from", "layer", "entrypoint", "multistage"],
        "content": "Copy dependency files like package.json first before source code to leverage Docker layer caching and speed up image builds."
    },
    {
        "topic": "git_branching",
        "keywords": ["git", "branch", "checkout", "merge", "commit", "rebase", "conflict", "head"],
        "content": "Use 'git checkout -b feature-name' to create and switch to a branch. Use 'git merge feature-name' from main to integrate code."
    },
    {
        "topic": "k8s_pods",
        "keywords": ["kubernetes", "k8s", "kubectl", "pod", "deployment", "service", "crashloopbackoff", "ingress"],
        "content": "Pods are the smallest deployable units in K8s. Use 'kubectl describe pod <name>' and 'kubectl logs <name>' to diagnose failing pods."
    },
    {
        "topic": "terraform_iac",
        "keywords": ["terraform", "tf", "hcl", "provider", "resource", "plan", "apply", "state"],
        "content": "Terraform provisions IaC declaratively. Always run 'terraform plan' to inspect changes before executing 'terraform apply'."
    },
    {
        "topic": "cicd_pipelines",
        "keywords": ["github", "actions", "pipeline", "workflow", "ci", "cd", "deploy", "runner"],
        "content": "CI/CD pipelines automate testing and deployment. Store secrets in GitHub Actions Secrets rather than hardcoding credentials in YAML."
    }
]

class DocRetriever:
    def __init__(self):
        self.docs = DOC_KNOWLEDGE_BASE

    def compute_tfidf_score(self, query: str, doc: dict) -> float:
        query_terms = re.findall(r'\w+', query.lower())
        if not query_terms:
            return 0.0

        doc_text = (doc["topic"] + " " + " ".join(doc["keywords"]) + " " + doc["content"]).lower()
        doc_terms = re.findall(r'\w+', doc_text)

        score = 0.0
        for term in set(query_terms):
            if term in doc_terms:
                tf = doc_terms.count(term) / len(doc_terms)
                idf = math.log(1 + (len(self.docs) / max(1, sum(1 for d in self.docs if term in (d["topic"] + " " + " ".join(d["keywords"])).lower()))))
                score += tf * idf * (3.0 if term in doc["keywords"] else 1.0)

        return score

    def retrieve(self, query: str, context_tags: list = None) -> list:
        scored_results = []

        for doc in self.docs:
            score = self.compute_tfidf_score(query, doc)
            if score > 0:
                scored_results.append((score, doc["content"], doc["topic"]))

        scored_results.sort(key=lambda x: x[0], reverse=True)
        return [r[1] for r in scored_results[:2]] if scored_results else [self.docs[0]["content"]]

retriever = DocRetriever()
