import re

DOC_KNOWLEDGE_BASE = [
    {
        "topic": "linux_permissions",
        "keywords": ["chmod", "permission", "denied", "rwx", "755", "644", "chown"],
        "content": "Linux file permissions consist of Owner, Group, and Others. Use 'chmod +x script.sh' to make a file executable. 755 means owner=rwx, group=r-x, others=r-x."
    },
    {
        "topic": "linux_navigation",
        "keywords": ["mkdir", "touch", "ls", "cd", "pwd", "directory", "file"],
        "content": "Use 'pwd' to print current working directory. Use 'mkdir -p a/b/c' to create nested directories. Use 'ls -la' to show hidden files."
    },
    {
        "topic": "docker_containers",
        "keywords": ["docker", "run", "container", "image", "pull", "ps", "port", "detach"],
        "content": "Docker containers share the host OS kernel. 'docker run -d -p 8080:80 nginx' runs Nginx in detached mode mapping host port 8080 to container port 80."
    },
    {
        "topic": "dockerfile",
        "keywords": ["dockerfile", "build", "copy", "cmd", "run", "from", "layer"],
        "content": "Copy dependency files like package.json first before source code to leverage Docker layer caching and speed up image builds."
    },
    {
        "topic": "git_branching",
        "keywords": ["git", "branch", "checkout", "merge", "commit", "rebase"],
        "content": "Use 'git checkout -b feature-name' to create and switch to a branch. Use 'git merge feature-name' from main to integrate code."
    },
    {
        "topic": "k8s_pods",
        "keywords": ["kubernetes", "k8s", "kubectl", "pod", "deployment", "service", "crashloopbackoff"],
        "content": "Pods are the smallest deployable units in K8s. Use 'kubectl describe pod <name>' and 'kubectl logs <name>' to diagnose failing pods."
    }
]

class DocRetriever:
    def __init__(self):
        self.docs = DOC_KNOWLEDGE_BASE

    def retrieve(self, query: str, context_tags: list = None) -> list:
        query_words = set(re.findall(r'\w+', query.lower()))
        results = []

        for doc in self.docs:
            score = 0
            for kw in doc["keywords"]:
                if kw in query_words or kw in query.lower():
                    score += 2

            if score > 0:
                results.append((score, doc["content"]))

        results.sort(key=lambda x: x[0], reverse=True)
        return [r[1] for r in results[:2]] if results else [self.docs[0]["content"]]

retriever = DocRetriever()
