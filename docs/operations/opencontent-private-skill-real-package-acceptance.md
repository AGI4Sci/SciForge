# OpenContent private Agent skill package acceptance

Date: 2026-08-26

This receipt records a local, credential-free deployment check of the private
customer-supplied `opencontent-base.zip`. The archive itself, extracted files,
absolute source path, account data and credentials are intentionally absent from
the repository.

## Input identity

- Skill: `opencontent-base`
- Declared version: `1.0.1`
- ZIP SHA-256:
  `2147c0ab8b571fd973575f04f0fd21537fb1918287f117cbe5c1e1959e083ae4`
- Accepted regular files: 33
- Accepted uncompressed bytes: 10,356,565

The digest is evidence for this exact tested delivery, not a hard-coded product
allowlist. Future senders provide the digest for their exact ZIP out of band.

## Closed-loop result

The generic private-skill verifier accepted the archive after CRC, bounds,
path, symlink, credential-file and root `SKILL.md` checks. The installer then:

1. atomically installed it into a new clean Workspace at the canonical
   `.codex/skills/opencontent-base` location;
2. wrote and re-read a local per-file digest receipt;
3. returned `already-installed` for the same archive without duplicating it;
4. allowed SciForge Workspace Intel to discover the installed skill with
   `SKILL.md` as its entry; and
5. executed no archive script or supplier command.

The private bytes remained outside Git. This receipt proves receipt-to-local
skill discovery only; it does not claim an OpenContent login, Provider ACL,
business operation or `production_ready` status.

The recipient workflow is documented in
[OpenContent 私有技能包安装手册](./opencontent-private-skill-install.zh-CN.md).
