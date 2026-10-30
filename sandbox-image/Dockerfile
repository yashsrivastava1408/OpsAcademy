# OpsAcademy student sandbox
#
# The image students get a shell in. It holds the tools the labs teach and
# nothing that grants privilege: no sudo, no setuid helpers, a non-root user.
# The gateway adds the runtime limits (no network, read-only root, dropped
# capabilities, memory/CPU/pid caps) when it starts each container.
#
# Build:  docker build -t opsacademy-sandbox:latest sandbox-image

FROM alpine:3.24

RUN apk add --no-cache \
      bash coreutils findutils grep sed gawk tar gzip \
      procps iproute2 net-tools curl \
      git openssh-client \
      python3 jq nano vim less make openssl \
 # Remove setuid/setgid bits: nothing here may be used to change user.
 && find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true

RUN addgroup -g 1000 student \
 && adduser -D -u 1000 -G student -h /home/student -s /bin/bash student

# The home directory is a tmpfs mounted at run time, so the prompt and
# defaults live in /etc where a login shell still finds them.
COPY profile.sh /etc/profile.d/opsacademy.sh

# The lab simulators: docker, kubectl and aws. There is no container runtime,
# cluster or network in a sandbox, so these Python scripts stand in for the
# real tools and keep their state under ~/.opsacademy. They are owned by root
# and read-only to the student, with no setuid bit.
COPY bin/ /usr/local/bin/
RUN chmod 755 /usr/local/bin/docker /usr/local/bin/kubectl /usr/local/bin/aws \
 && chmod 644 /usr/local/bin/_opsim.py

USER student
WORKDIR /home/student
ENV HOME=/home/student LANG=C.UTF-8

CMD ["/bin/sh"]
