# SciForge capability reference

<!-- GENERATED FILE. DO NOT EDIT. Run `npm run capability:generate`. -->

Authoritative source: `src/main/modules/index.ts`

Registered actions: **124**

| Action ID | Version | Audiences | Effect | Approval | Scope |
| --- | --- | --- | --- | --- | --- |
| `anchored-comments.asset.read` | 1.0.0 | ui, agent | read | none | global |
| `anchored-comments.capture` | 1.0.0 | ui, agent | workspace-write | none | global |
| `anchored-comments.delete` | 1.0.0 | ui, agent | workspace-write | confirmation | global |
| `anchored-comments.feedback.status` | 1.0.0 | ui, agent | read | none | global |
| `anchored-comments.feedback.submit` | 1.0.0 | ui, agent | external-write | confirmation | global |
| `anchored-comments.get` | 1.0.0 | ui, agent | read | none | global |
| `anchored-comments.list` | 1.0.0 | ui, agent | read | none | global |
| `anchored-comments.upsert` | 1.0.0 | ui, agent | workspace-write | none | global |
| `biology-room.apply` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `biology-room.create` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `biology-room.history` | 1.0.0 | ui, agent, system | read | none | resource |
| `biology-room.list` | 1.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.load` | 1.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.open` | 1.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.open-or-create` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `biology-room.refresh` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `browser-preview.back` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `browser-preview.click` | 1.0.0 | ui, agent | destructive | confirmation | resource |
| `browser-preview.fill` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `browser-preview.forward` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `browser-preview.navigate` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `browser-preview.open` | 1.0.0 | ui | external-write | none | global |
| `browser-preview.press` | 1.0.0 | ui, agent | destructive | confirmation | resource |
| `browser-preview.read` | 1.0.0 | ui, agent | read | none | resource |
| `browser-preview.reload` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `browser-preview.select` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `change-inspector.open-session` | 1.0.0 | ui | read | none | workspace |
| `controlled-process.create` | 1.0.0 | ui | external-write | none | workspace |
| `controlled-process.dispose` | 1.0.0 | ui | external-write | none | resource |
| `controlled-process.read` | 1.0.0 | ui | read | none | resource |
| `controlled-process.resize` | 1.0.0 | ui | compute | none | resource |
| `controlled-process.write` | 1.0.0 | ui | external-write | none | resource |
| `create-loop.check-code` | 1.0.0 | ui, agent | compute | none | workspace |
| `create-loop.export-dsl` | 1.0.0 | ui, agent | read | none | workspace |
| `create-loop.import-dsl` | 1.0.0 | ui, agent | compute | none | workspace |
| `create-loop.read` | 1.0.0 | ui, agent | read | none | workspace |
| `create-loop.resolve-approval` | 1.0.0 | ui, agent | external-write | confirmation | workspace |
| `create-loop.run` | 1.0.0 | ui, agent | external-write | confirmation | workspace |
| `create-loop.run-node` | 1.0.0 | ui, agent | external-write | confirmation | workspace |
| `create-loop.save` | 1.0.0 | ui, agent | workspace-write | none | workspace |
| `create-loop.status` | 1.0.0 | ui, agent | read | none | workspace |
| `create-loop.stop` | 1.0.0 | ui, agent | external-write | confirmation | workspace |
| `create-loop.test-node` | 1.0.0 | ui, agent | compute | none | workspace |
| `evidence-dag.priority` | 1.0.0 | ui, agent | compute | none | global |
| `evidence-dag.resolve-evidence-preview` | 1.0.0 | ui, agent | read | none | global |
| `evidence-dag.update` | 1.0.0 | ui, agent | compute | none | global |
| `evidence-dag.view` | 1.0.0 | ui, agent, system | read | none | global |
| `git-checkpoints.create` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `git-checkpoints.list` | 1.0.0 | ui, agent, system | read | none | workspace |
| `git-checkpoints.preview` | 1.0.0 | ui, agent, system | read | none | workspace |
| `git-checkpoints.restore` | 1.0.0 | ui, agent | destructive | confirmation | workspace |
| `paper-radar.digest` | 1.0.0 | ui, agent, system | read | none | global |
| `paper-radar.profiles.list` | 1.0.0 | ui, agent, system | read | none | global |
| `paper-radar.profiles.save` | 1.0.0 | ui, agent, system | external-write | confirmation | global |
| `paper-radar.rank` | 1.0.0 | ui, agent, system | read | none | global |
| `paper-radar.review` | 1.0.0 | ui, agent, system | external-write | confirmation | global |
| `paper-radar.search` | 1.0.0 | ui, agent, system | read | none | global |
| `paper-radar.status` | 1.0.0 | ui, agent, system | read | none | global |
| `paper-radar.sync-arxiv` | 1.0.0 | ui, agent, system | external-write | confirmation | global |
| `paper-radar.sync-biorxiv` | 1.0.0 | ui, agent, system | external-write | confirmation | global |
| `paper-radar.sync-profile` | 1.0.0 | ui, agent, system | external-write | confirmation | global |
| `project-dag.evidence-preview.resolve` | 1.0.0 | ui, agent, system | read | none | workspace |
| `project-dag.goal.save` | 1.0.0 | ui, agent, system | compute | none | workspace |
| `project-dag.update` | 1.0.0 | ui, agent, system | compute | none | workspace |
| `project-dag.view` | 1.0.0 | ui, agent, system | read | none | workspace |
| `remote-ssh.bindings.get` | 1.0.0 | ui | read | none | workspace |
| `remote-ssh.bindings.save` | 1.0.0 | ui | external-write | confirmation | workspace |
| `remote-ssh.command.cancel` | 1.0.0 | ui, agent | external-write | confirmation | workspace |
| `remote-ssh.command.execute` | 1.0.0 | ui, agent | destructive | confirmation | resource |
| `remote-ssh.egress-session.open` | 1.0.0 | ui | external-write | confirmation | resource |
| `remote-ssh.file.download` | 1.0.0 | ui, agent | workspace-write | confirmation | resource |
| `remote-ssh.file.upload` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `remote-ssh.lab-environment.console.open` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.lab-environment.ensure` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.lab-environment.get` | 1.0.0 | ui | read | none | global |
| `remote-ssh.lab-environment.stop` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.labs.delete` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.labs.list` | 1.0.0 | ui | read | none | global |
| `remote-ssh.labs.save` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.openssh-config.open` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.target.delete` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.target.probe` | 1.0.0 | ui, agent, system | read | none | resource |
| `remote-ssh.target.save` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.targets.catalog` | 1.0.0 | ui | read | none | global |
| `remote-ssh.targets.list` | 1.0.0 | ui, agent, system | read | none | workspace |
| `remote-ssh.virtualbox-machines.list` | 1.0.0 | ui | read | none | global |
| `remote-ssh.workspace-host-session.open` | 1.0.0 | ui | external-write | confirmation | resource |
| `surface.current` | 2.0.0 | ui, agent, system | read | none | global |
| `version-control.create-reference` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `version-control.create-snapshot` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `version-control.diff` | 1.0.0 | ui, agent, system | read | none | resource |
| `version-control.list-snapshots` | 1.0.0 | ui, agent, system | read | none | resource |
| `version-control.open-workspace` | 1.0.0 | ui, agent, system | read | none | workspace |
| `version-control.preview-restore` | 1.0.0 | ui, agent, system | read | none | resource |
| `version-control.read-file` | 1.0.0 | ui, agent, system | read | none | resource |
| `version-control.restore` | 1.0.0 | ui, agent, system | destructive | confirmation | resource |
| `version-control.status` | 1.0.0 | ui, agent, system | read | none | resource |
| `visual-review.accept-candidate` | 1.0.0 | ui | destructive | confirmation | workspace |
| `visual-review.apply-style-reference` | 1.0.0 | ui | workspace-write | none | workspace |
| `visual-review.create-candidate` | 1.0.0 | agent, system | workspace-write | none | workspace |
| `visual-review.export-review-packet` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `visual-review.open` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `visual-review.read-document` | 1.0.0 | ui, agent, system | read | none | workspace |
| `visual-review.read-image` | 1.0.0 | ui | read | none | workspace |
| `visual-review.reject-candidate` | 1.0.0 | ui | workspace-write | none | workspace |
| `visual-review.save-annotations` | 1.0.0 | ui | workspace-write | none | workspace |
| `visual-review.update-context` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `workspace-preview.annotations.delete` | 2.0.0 | ui, agent, system | workspace-write | none | resource |
| `workspace-preview.annotations.import` | 2.0.0 | ui | workspace-write | none | resource |
| `workspace-preview.annotations.list` | 2.0.0 | ui, agent, system | read | none | resource |
| `workspace-preview.annotations.resolve` | 2.0.0 | ui, agent, system | workspace-write | none | resource |
| `workspace-preview.annotations.review.generate` | 2.0.0 | ui | workspace-write | confirmation | resource |
| `workspace-preview.annotations.review.improve` | 2.0.0 | ui | workspace-write | confirmation | resource |
| `workspace-preview.annotations.update` | 2.0.0 | ui, agent, system | workspace-write | none | resource |
| `workspace-preview.apply-edit` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `workspace-preview.describe-asset` | 1.0.0 | ui, agent, system | read | none | resource |
| `workspace-preview.export` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `workspace-preview.invoke-action` | 1.0.0 | ui | workspace-write | none | resource |
| `workspace-preview.list` | 1.0.0 | ui, agent, system | read | none | global |
| `workspace-preview.open` | 1.0.0 | ui, agent, system | read | none | workspace |
| `workspace-preview.prepare-artifact` | 1.0.0 | ui, agent, system | compute | none | resource |
| `workspace-preview.read-artifact-range` | 1.0.0 | ui, agent, system | read | none | resource |
| `workspace-preview.read-range` | 1.0.0 | ui, agent, system | read | none | resource |
| `workspace-preview.release` | 1.0.0 | ui, agent, system | compute | none | resource |

## `anchored-comments.asset.read`

Reads one integrity-checked package screenshot as a renderer-safe data URL.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "asset": {
        "additionalProperties": false,
        "properties": {
          "byteLength": {
            "exclusiveMinimum": 0,
            "maximum": 26214400,
            "type": "integer"
          },
          "digest": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          },
          "mimeType": {
            "const": "image/png",
            "type": "string"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          }
        },
        "required": [
          "digest",
          "mimeType",
          "byteLength",
          "width",
          "height"
        ],
        "type": "object"
      }
    },
    "required": [
      "asset"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "dataUrl": {
        "maxLength": 36700160,
        "pattern": "^data:image\\/png;base64,.*",
        "type": "string"
      },
      "digest": {
        "pattern": "^[a-f0-9]{64}$",
        "type": "string"
      },
      "mimeType": {
        "const": "image/png",
        "type": "string"
      }
    },
    "required": [
      "digest",
      "mimeType",
      "dataUrl"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Read anchored comment evidence"
}
```

## `anchored-comments.capture`

Captures an explicitly registered visual target through Host redaction policy.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `workspace-write`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "locale": {
        "maxLength": 64,
        "type": "string"
      },
      "route": {
        "maxLength": 512,
        "type": "string"
      },
      "targetBounds": {
        "additionalProperties": false,
        "properties": {
          "height": {
            "exclusiveMinimum": 0,
            "type": "number"
          },
          "width": {
            "exclusiveMinimum": 0,
            "type": "number"
          },
          "x": {
            "minimum": 0,
            "type": "number"
          },
          "y": {
            "minimum": 0,
            "type": "number"
          }
        },
        "required": [
          "x",
          "y",
          "width",
          "height"
        ],
        "type": "object"
      },
      "targetLabel": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "targetRef": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "theme": {
        "maxLength": 64,
        "type": "string"
      },
      "viewport": {
        "additionalProperties": false,
        "properties": {
          "height": {
            "exclusiveMinimum": 0,
            "type": "number"
          },
          "scaleFactor": {
            "exclusiveMinimum": 0,
            "maximum": 16,
            "type": "number"
          },
          "width": {
            "exclusiveMinimum": 0,
            "type": "number"
          }
        },
        "required": [
          "width",
          "height",
          "scaleFactor"
        ],
        "type": "object"
      }
    },
    "required": [
      "targetRef",
      "targetBounds",
      "targetLabel",
      "viewport"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "capture": {
            "additionalProperties": false,
            "properties": {
              "appBuild": {
                "maxLength": 128,
                "type": "string"
              },
              "appVersion": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "capturedAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "contentDigest": {
                "maxLength": 256,
                "type": "string"
              },
              "focusedScreenshot": {
                "additionalProperties": false,
                "properties": {
                  "byteLength": {
                    "exclusiveMinimum": 0,
                    "maximum": 26214400,
                    "type": "integer"
                  },
                  "digest": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "mimeType": {
                    "const": "image/png",
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  }
                },
                "required": [
                  "digest",
                  "mimeType",
                  "byteLength",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "fullWindowScreenshot": {
                "additionalProperties": false,
                "properties": {
                  "byteLength": {
                    "exclusiveMinimum": 0,
                    "maximum": 26214400,
                    "type": "integer"
                  },
                  "digest": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "mimeType": {
                    "const": "image/png",
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  }
                },
                "required": [
                  "digest",
                  "mimeType",
                  "byteLength",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "locale": {
                "maxLength": 64,
                "type": "string"
              },
              "osVersion": {
                "maxLength": 128,
                "type": "string"
              },
              "platform": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "redacted": {
                "type": "boolean"
              },
              "route": {
                "maxLength": 512,
                "type": "string"
              },
              "targetBounds": {
                "additionalProperties": false,
                "properties": {
                  "height": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "x": {
                    "minimum": 0,
                    "type": "number"
                  },
                  "y": {
                    "minimum": 0,
                    "type": "number"
                  }
                },
                "required": [
                  "x",
                  "y",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "targetLabel": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "theme": {
                "maxLength": 64,
                "type": "string"
              },
              "unavailableReason": {
                "maxLength": 1000,
                "type": "string"
              },
              "viewport": {
                "additionalProperties": false,
                "properties": {
                  "height": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "scaleFactor": {
                    "exclusiveMinimum": 0,
                    "maximum": 16,
                    "type": "number"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  }
                },
                "required": [
                  "width",
                  "height",
                  "scaleFactor"
                ],
                "type": "object"
              }
            },
            "required": [
              "capturedAt",
              "appVersion",
              "platform",
              "viewport",
              "targetLabel",
              "targetBounds"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "capture"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 2000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Capture anchored comment evidence"
}
```

## `anchored-comments.delete`

Deletes one comment thread and unreferenced package evidence.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `workspace-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "threadId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "threadId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "deleted": {
        "type": "boolean"
      }
    },
    "required": [
      "deleted"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Delete anchored comment"
}
```

## `anchored-comments.feedback.status`

Reads feedback submission state for one comment thread.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "threadId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "threadId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "feedback": {
            "additionalProperties": false,
            "properties": {
              "disclosure": {
                "additionalProperties": false,
                "properties": {
                  "annotatedScreenshots": {
                    "type": "boolean"
                  },
                  "applicationEnvironment": {
                    "type": "boolean"
                  },
                  "conversationExcerpt": {
                    "type": "boolean"
                  },
                  "fileMetadata": {
                    "type": "boolean"
                  },
                  "logs": {
                    "type": "boolean"
                  },
                  "workspacePaths": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "annotatedScreenshots",
                  "applicationEnvironment",
                  "logs",
                  "conversationExcerpt",
                  "workspacePaths",
                  "fileMetadata"
                ],
                "type": "object"
              },
              "error": {
                "maxLength": 2000,
                "type": "string"
              },
              "idempotencyKey": {
                "maxLength": 256,
                "type": "string"
              },
              "issue": {
                "additionalProperties": false,
                "properties": {
                  "assetUrls": {
                    "items": {
                      "format": "uri",
                      "maxLength": 2048,
                      "type": "string"
                    },
                    "maxItems": 16,
                    "type": "array"
                  },
                  "author": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "issueNumber": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "issueUrl": {
                    "format": "uri",
                    "maxLength": 2048,
                    "type": "string"
                  },
                  "submittedAt": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "issueNumber",
                  "issueUrl",
                  "assetUrls",
                  "submittedAt"
                ],
                "type": "object"
              },
              "state": {
                "enum": [
                  "local",
                  "submitting",
                  "submitted",
                  "failed"
                ],
                "type": "string"
              },
              "updatedAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "state"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "feedback"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 2000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Read anchored comment feedback status"
}
```

## `anchored-comments.feedback.submit`

Publishes explicitly disclosed product feedback through the configured gateway.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "packet": {
        "additionalProperties": false,
        "properties": {
          "body": {
            "maxLength": 100000,
            "minLength": 1,
            "type": "string"
          },
          "conversationExcerpt": {
            "maxLength": 100000,
            "type": "string"
          },
          "disclosure": {
            "additionalProperties": false,
            "properties": {
              "annotatedScreenshots": {
                "type": "boolean"
              },
              "applicationEnvironment": {
                "type": "boolean"
              },
              "conversationExcerpt": {
                "type": "boolean"
              },
              "fileMetadata": {
                "type": "boolean"
              },
              "logs": {
                "type": "boolean"
              },
              "workspacePaths": {
                "type": "boolean"
              }
            },
            "required": [
              "annotatedScreenshots",
              "applicationEnvironment",
              "logs",
              "conversationExcerpt",
              "workspacePaths",
              "fileMetadata"
            ],
            "type": "object"
          },
          "environment": {
            "additionalProperties": {
              "maxLength": 4096,
              "type": "string"
            },
            "propertyNames": {
              "maxLength": 128,
              "type": "string"
            },
            "type": "object"
          },
          "fileMetadata": {
            "items": {
              "additionalProperties": {
                "maxLength": 4096,
                "type": "string"
              },
              "propertyNames": {
                "maxLength": 128,
                "type": "string"
              },
              "type": "object"
            },
            "maxItems": 128,
            "type": "array"
          },
          "idempotencyKey": {
            "maxLength": 256,
            "minLength": 16,
            "type": "string"
          },
          "logs": {
            "maxLength": 200000,
            "type": "string"
          },
          "repository": {
            "additionalProperties": false,
            "properties": {
              "name": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "owner": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "owner",
              "name"
            ],
            "type": "object"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "screenshots": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "asset": {
                  "additionalProperties": false,
                  "properties": {
                    "byteLength": {
                      "exclusiveMinimum": 0,
                      "maximum": 26214400,
                      "type": "integer"
                    },
                    "digest": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 100000,
                      "type": "integer"
                    },
                    "mimeType": {
                      "const": "image/png",
                      "type": "string"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 100000,
                      "type": "integer"
                    }
                  },
                  "required": [
                    "digest",
                    "mimeType",
                    "byteLength",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "dataBase64": {
                  "maxLength": 36700160,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "full_window",
                    "focused"
                  ],
                  "type": "string"
                }
              },
              "required": [
                "kind",
                "asset"
              ],
              "type": "object"
            },
            "maxItems": 2,
            "type": "array"
          },
          "threadId": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "title": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "workspacePaths": {
            "items": {
              "maxLength": 4096,
              "type": "string"
            },
            "maxItems": 64,
            "type": "array"
          }
        },
        "required": [
          "schemaVersion",
          "idempotencyKey",
          "threadId",
          "repository",
          "title",
          "body",
          "disclosure"
        ],
        "type": "object"
      }
    },
    "required": [
      "packet"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "result": {
            "additionalProperties": false,
            "properties": {
              "assetUrls": {
                "items": {
                  "format": "uri",
                  "maxLength": 2048,
                  "type": "string"
                },
                "maxItems": 16,
                "type": "array"
              },
              "author": {
                "maxLength": 256,
                "type": "string"
              },
              "createdAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "idempotencyKey": {
                "maxLength": 256,
                "minLength": 16,
                "type": "string"
              },
              "issueNumber": {
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991,
                "type": "integer"
              },
              "issueUrl": {
                "format": "uri",
                "maxLength": 2048,
                "type": "string"
              },
              "schemaVersion": {
                "const": 1,
                "type": "number"
              }
            },
            "required": [
              "schemaVersion",
              "idempotencyKey",
              "issueNumber",
              "issueUrl",
              "assetUrls",
              "createdAt"
            ],
            "type": "object"
          }
        },
        "required": [
          "ok",
          "result"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 2000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "retryable": {
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message",
          "retryable"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Submit anchored comment feedback"
}
```

## `anchored-comments.get`

Reads one anchored comment thread.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "threadId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "threadId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "thread": {
        "anyOf": [
          {
            "additionalProperties": false,
            "properties": {
              "anchor": {
                "additionalProperties": false,
                "properties": {
                  "bounds": {
                    "additionalProperties": false,
                    "properties": {
                      "height": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      },
                      "width": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number"
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number"
                      }
                    },
                    "required": [
                      "x",
                      "y",
                      "width",
                      "height"
                    ],
                    "type": "object"
                  },
                  "canonical": {
                    "oneOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "contentDigest": {
                            "maxLength": 256,
                            "type": "string"
                          },
                          "kind": {
                            "const": "research",
                            "type": "string"
                          },
                          "resourceId": {
                            "maxLength": 2048,
                            "minLength": 1,
                            "type": "string"
                          },
                          "resourceKind": {
                            "maxLength": 128,
                            "minLength": 1,
                            "type": "string"
                          },
                          "selection": {
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "anyOf": [
                                    {
                                      "maxLength": 4096,
                                      "type": "string"
                                    },
                                    {
                                      "type": "number"
                                    },
                                    {
                                      "type": "boolean"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                {
                                  "items": {
                                    "anyOf": [
                                      {
                                        "maxLength": 4096,
                                        "type": "string"
                                      },
                                      {
                                        "type": "number"
                                      },
                                      {
                                        "type": "boolean"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "maxItems": 64,
                                  "type": "array"
                                }
                              ]
                            },
                            "propertyNames": {
                              "maxLength": 128,
                              "minLength": 1,
                              "type": "string"
                            },
                            "type": "object"
                          }
                        },
                        "required": [
                          "kind",
                          "resourceKind",
                          "resourceId"
                        ],
                        "type": "object"
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "componentId": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "elementId": {
                            "maxLength": 256,
                            "type": "string"
                          },
                          "kind": {
                            "const": "ui",
                            "type": "string"
                          },
                          "route": {
                            "maxLength": 512,
                            "type": "string"
                          },
                          "selection": {
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "anyOf": [
                                    {
                                      "maxLength": 4096,
                                      "type": "string"
                                    },
                                    {
                                      "type": "number"
                                    },
                                    {
                                      "type": "boolean"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                {
                                  "items": {
                                    "anyOf": [
                                      {
                                        "maxLength": 4096,
                                        "type": "string"
                                      },
                                      {
                                        "type": "number"
                                      },
                                      {
                                        "type": "boolean"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "maxItems": 64,
                                  "type": "array"
                                }
                              ]
                            },
                            "propertyNames": {
                              "maxLength": 128,
                              "minLength": 1,
                              "type": "string"
                            },
                            "type": "object"
                          }
                        },
                        "required": [
                          "kind",
                          "componentId"
                        ],
                        "type": "object"
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "kind": {
                            "const": "visual",
                            "type": "string"
                          },
                          "route": {
                            "maxLength": 512,
                            "type": "string"
                          },
                          "selection": {
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "anyOf": [
                                    {
                                      "maxLength": 4096,
                                      "type": "string"
                                    },
                                    {
                                      "type": "number"
                                    },
                                    {
                                      "type": "boolean"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                {
                                  "items": {
                                    "anyOf": [
                                      {
                                        "maxLength": 4096,
                                        "type": "string"
                                      },
                                      {
                                        "type": "number"
                                      },
                                      {
                                        "type": "boolean"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "maxItems": 64,
                                  "type": "array"
                                }
                              ]
                            },
                            "propertyNames": {
                              "maxLength": 128,
                              "minLength": 1,
                              "type": "string"
                            },
                            "type": "object"
                          }
                        },
                        "required": [
                          "kind"
                        ],
                        "type": "object"
                      }
                    ]
                  },
                  "domFingerprint": {
                    "additionalProperties": false,
                    "properties": {
                      "accessibleName": {
                        "maxLength": 512,
                        "type": "string"
                      },
                      "commentId": {
                        "maxLength": 256,
                        "type": "string"
                      },
                      "path": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "classes": {
                              "items": {
                                "maxLength": 128,
                                "minLength": 1,
                                "type": "string"
                              },
                              "maxItems": 8,
                              "type": "array"
                            },
                            "id": {
                              "maxLength": 256,
                              "type": "string"
                            },
                            "nthOfType": {
                              "exclusiveMinimum": 0,
                              "maximum": 10000,
                              "type": "integer"
                            },
                            "tagName": {
                              "maxLength": 64,
                              "minLength": 1,
                              "type": "string"
                            }
                          },
                          "required": [
                            "tagName"
                          ],
                          "type": "object"
                        },
                        "maxItems": 12,
                        "type": "array"
                      },
                      "role": {
                        "maxLength": 128,
                        "type": "string"
                      },
                      "tagName": {
                        "maxLength": 64,
                        "minLength": 1,
                        "type": "string"
                      },
                      "testId": {
                        "maxLength": 256,
                        "type": "string"
                      },
                      "visibleText": {
                        "maxLength": 1000,
                        "type": "string"
                      }
                    },
                    "required": [
                      "tagName"
                    ],
                    "type": "object"
                  },
                  "targetKey": {
                    "maxLength": 2048,
                    "minLength": 1,
                    "type": "string"
                  },
                  "targetLabel": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "targetKey",
                  "targetLabel",
                  "canonical",
                  "bounds"
                ],
                "type": "object"
              },
              "anchorResolution": {
                "enum": [
                  "resolved",
                  "needs_retargeting"
                ],
                "type": "string"
              },
              "capture": {
                "additionalProperties": false,
                "properties": {
                  "appBuild": {
                    "maxLength": 128,
                    "type": "string"
                  },
                  "appVersion": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  },
                  "capturedAt": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  },
                  "contentDigest": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "focusedScreenshot": {
                    "additionalProperties": false,
                    "properties": {
                      "byteLength": {
                        "exclusiveMinimum": 0,
                        "maximum": 26214400,
                        "type": "integer"
                      },
                      "digest": {
                        "pattern": "^[a-f0-9]{64}$",
                        "type": "string"
                      },
                      "height": {
                        "exclusiveMinimum": 0,
                        "maximum": 100000,
                        "type": "integer"
                      },
                      "mimeType": {
                        "const": "image/png",
                        "type": "string"
                      },
                      "width": {
                        "exclusiveMinimum": 0,
                        "maximum": 100000,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "digest",
                      "mimeType",
                      "byteLength",
                      "width",
                      "height"
                    ],
                    "type": "object"
                  },
                  "fullWindowScreenshot": {
                    "additionalProperties": false,
                    "properties": {
                      "byteLength": {
                        "exclusiveMinimum": 0,
                        "maximum": 26214400,
                        "type": "integer"
                      },
                      "digest": {
                        "pattern": "^[a-f0-9]{64}$",
                        "type": "string"
                      },
                      "height": {
                        "exclusiveMinimum": 0,
                        "maximum": 100000,
                        "type": "integer"
                      },
                      "mimeType": {
                        "const": "image/png",
                        "type": "string"
                      },
                      "width": {
                        "exclusiveMinimum": 0,
                        "maximum": 100000,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "digest",
                      "mimeType",
                      "byteLength",
                      "width",
                      "height"
                    ],
                    "type": "object"
                  },
                  "locale": {
                    "maxLength": 64,
                    "type": "string"
                  },
                  "osVersion": {
                    "maxLength": 128,
                    "type": "string"
                  },
                  "platform": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  },
                  "redacted": {
                    "type": "boolean"
                  },
                  "route": {
                    "maxLength": 512,
                    "type": "string"
                  },
                  "targetBounds": {
                    "additionalProperties": false,
                    "properties": {
                      "height": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      },
                      "width": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number"
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number"
                      }
                    },
                    "required": [
                      "x",
                      "y",
                      "width",
                      "height"
                    ],
                    "type": "object"
                  },
                  "targetLabel": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "theme": {
                    "maxLength": 64,
                    "type": "string"
                  },
                  "unavailableReason": {
                    "maxLength": 1000,
                    "type": "string"
                  },
                  "viewport": {
                    "additionalProperties": false,
                    "properties": {
                      "height": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      },
                      "scaleFactor": {
                        "exclusiveMinimum": 0,
                        "maximum": 16,
                        "type": "number"
                      },
                      "width": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      }
                    },
                    "required": [
                      "width",
                      "height",
                      "scaleFactor"
                    ],
                    "type": "object"
                  }
                },
                "required": [
                  "capturedAt",
                  "appVersion",
                  "platform",
                  "viewport",
                  "targetLabel",
                  "targetBounds"
                ],
                "type": "object"
              },
              "createdAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "feedback": {
                "additionalProperties": false,
                "properties": {
                  "disclosure": {
                    "additionalProperties": false,
                    "properties": {
                      "annotatedScreenshots": {
                        "type": "boolean"
                      },
                      "applicationEnvironment": {
                        "type": "boolean"
                      },
                      "conversationExcerpt": {
                        "type": "boolean"
                      },
                      "fileMetadata": {
                        "type": "boolean"
                      },
                      "logs": {
                        "type": "boolean"
                      },
                      "workspacePaths": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "annotatedScreenshots",
                      "applicationEnvironment",
                      "logs",
                      "conversationExcerpt",
                      "workspacePaths",
                      "fileMetadata"
                    ],
                    "type": "object"
                  },
                  "error": {
                    "maxLength": 2000,
                    "type": "string"
                  },
                  "idempotencyKey": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "issue": {
                    "additionalProperties": false,
                    "properties": {
                      "assetUrls": {
                        "items": {
                          "format": "uri",
                          "maxLength": 2048,
                          "type": "string"
                        },
                        "maxItems": 16,
                        "type": "array"
                      },
                      "author": {
                        "maxLength": 256,
                        "type": "string"
                      },
                      "issueNumber": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "issueUrl": {
                        "format": "uri",
                        "maxLength": 2048,
                        "type": "string"
                      },
                      "submittedAt": {
                        "maxLength": 64,
                        "minLength": 1,
                        "type": "string"
                      }
                    },
                    "required": [
                      "issueNumber",
                      "issueUrl",
                      "assetUrls",
                      "submittedAt"
                    ],
                    "type": "object"
                  },
                  "state": {
                    "enum": [
                      "local",
                      "submitting",
                      "submitted",
                      "failed"
                    ],
                    "type": "string"
                  },
                  "updatedAt": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "state"
                ],
                "type": "object"
              },
              "id": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "messages": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "authorId": {
                      "maxLength": 256,
                      "type": "string"
                    },
                    "authorKind": {
                      "enum": [
                        "user",
                        "ai",
                        "system"
                      ],
                      "type": "string"
                    },
                    "body": {
                      "maxLength": 20000,
                      "minLength": 1,
                      "type": "string"
                    },
                    "createdAt": {
                      "maxLength": 64,
                      "minLength": 1,
                      "type": "string"
                    },
                    "id": {
                      "maxLength": 256,
                      "minLength": 1,
                      "type": "string"
                    },
                    "updatedAt": {
                      "maxLength": 64,
                      "minLength": 1,
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "authorKind",
                    "body",
                    "createdAt",
                    "updatedAt"
                  ],
                  "type": "object"
                },
                "maxItems": 500,
                "minItems": 1,
                "type": "array"
              },
              "purpose": {
                "enum": [
                  "research",
                  "product_feedback"
                ],
                "type": "string"
              },
              "schemaVersion": {
                "const": 1,
                "type": "number"
              },
              "status": {
                "enum": [
                  "open",
                  "attached",
                  "ai_responded",
                  "awaiting_verification",
                  "resolved"
                ],
                "type": "string"
              },
              "updatedAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "workspaceKey": {
                "maxLength": 2048,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "schemaVersion",
              "id",
              "workspaceKey",
              "purpose",
              "anchor",
              "capture",
              "messages",
              "status",
              "anchorResolution",
              "feedback",
              "createdAt",
              "updatedAt"
            ],
            "type": "object"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "thread"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Read anchored comment"
}
```

## `anchored-comments.list`

Lists package-owned comment threads through a bounded filter.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "includeResolved": {
        "type": "boolean"
      },
      "purpose": {
        "enum": [
          "research",
          "product_feedback"
        ],
        "type": "string"
      },
      "status": {
        "enum": [
          "open",
          "attached",
          "ai_responded",
          "awaiting_verification",
          "resolved"
        ],
        "type": "string"
      },
      "targetKey": {
        "maxLength": 2048,
        "minLength": 1,
        "type": "string"
      },
      "workspaceKey": {
        "maxLength": 2048,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "threads": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "anchor": {
              "additionalProperties": false,
              "properties": {
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    },
                    "x": {
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "canonical": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "contentDigest": {
                          "maxLength": 256,
                          "type": "string"
                        },
                        "kind": {
                          "const": "research",
                          "type": "string"
                        },
                        "resourceId": {
                          "maxLength": 2048,
                          "minLength": 1,
                          "type": "string"
                        },
                        "resourceKind": {
                          "maxLength": 128,
                          "minLength": 1,
                          "type": "string"
                        },
                        "selection": {
                          "additionalProperties": {
                            "anyOf": [
                              {
                                "anyOf": [
                                  {
                                    "maxLength": 4096,
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  },
                                  {
                                    "type": "boolean"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              {
                                "items": {
                                  "anyOf": [
                                    {
                                      "maxLength": 4096,
                                      "type": "string"
                                    },
                                    {
                                      "type": "number"
                                    },
                                    {
                                      "type": "boolean"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                "maxItems": 64,
                                "type": "array"
                              }
                            ]
                          },
                          "propertyNames": {
                            "maxLength": 128,
                            "minLength": 1,
                            "type": "string"
                          },
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "resourceKind",
                        "resourceId"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "componentId": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "elementId": {
                          "maxLength": 256,
                          "type": "string"
                        },
                        "kind": {
                          "const": "ui",
                          "type": "string"
                        },
                        "route": {
                          "maxLength": 512,
                          "type": "string"
                        },
                        "selection": {
                          "additionalProperties": {
                            "anyOf": [
                              {
                                "anyOf": [
                                  {
                                    "maxLength": 4096,
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  },
                                  {
                                    "type": "boolean"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              {
                                "items": {
                                  "anyOf": [
                                    {
                                      "maxLength": 4096,
                                      "type": "string"
                                    },
                                    {
                                      "type": "number"
                                    },
                                    {
                                      "type": "boolean"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                "maxItems": 64,
                                "type": "array"
                              }
                            ]
                          },
                          "propertyNames": {
                            "maxLength": 128,
                            "minLength": 1,
                            "type": "string"
                          },
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "componentId"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "visual",
                          "type": "string"
                        },
                        "route": {
                          "maxLength": 512,
                          "type": "string"
                        },
                        "selection": {
                          "additionalProperties": {
                            "anyOf": [
                              {
                                "anyOf": [
                                  {
                                    "maxLength": 4096,
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  },
                                  {
                                    "type": "boolean"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              {
                                "items": {
                                  "anyOf": [
                                    {
                                      "maxLength": 4096,
                                      "type": "string"
                                    },
                                    {
                                      "type": "number"
                                    },
                                    {
                                      "type": "boolean"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                "maxItems": 64,
                                "type": "array"
                              }
                            ]
                          },
                          "propertyNames": {
                            "maxLength": 128,
                            "minLength": 1,
                            "type": "string"
                          },
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "domFingerprint": {
                  "additionalProperties": false,
                  "properties": {
                    "accessibleName": {
                      "maxLength": 512,
                      "type": "string"
                    },
                    "commentId": {
                      "maxLength": 256,
                      "type": "string"
                    },
                    "path": {
                      "items": {
                        "additionalProperties": false,
                        "properties": {
                          "classes": {
                            "items": {
                              "maxLength": 128,
                              "minLength": 1,
                              "type": "string"
                            },
                            "maxItems": 8,
                            "type": "array"
                          },
                          "id": {
                            "maxLength": 256,
                            "type": "string"
                          },
                          "nthOfType": {
                            "exclusiveMinimum": 0,
                            "maximum": 10000,
                            "type": "integer"
                          },
                          "tagName": {
                            "maxLength": 64,
                            "minLength": 1,
                            "type": "string"
                          }
                        },
                        "required": [
                          "tagName"
                        ],
                        "type": "object"
                      },
                      "maxItems": 12,
                      "type": "array"
                    },
                    "role": {
                      "maxLength": 128,
                      "type": "string"
                    },
                    "tagName": {
                      "maxLength": 64,
                      "minLength": 1,
                      "type": "string"
                    },
                    "testId": {
                      "maxLength": 256,
                      "type": "string"
                    },
                    "visibleText": {
                      "maxLength": 1000,
                      "type": "string"
                    }
                  },
                  "required": [
                    "tagName"
                  ],
                  "type": "object"
                },
                "targetKey": {
                  "maxLength": 2048,
                  "minLength": 1,
                  "type": "string"
                },
                "targetLabel": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "targetKey",
                "targetLabel",
                "canonical",
                "bounds"
              ],
              "type": "object"
            },
            "anchorResolution": {
              "enum": [
                "resolved",
                "needs_retargeting"
              ],
              "type": "string"
            },
            "capture": {
              "additionalProperties": false,
              "properties": {
                "appBuild": {
                  "maxLength": 128,
                  "type": "string"
                },
                "appVersion": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "capturedAt": {
                  "maxLength": 64,
                  "minLength": 1,
                  "type": "string"
                },
                "contentDigest": {
                  "maxLength": 256,
                  "type": "string"
                },
                "focusedScreenshot": {
                  "additionalProperties": false,
                  "properties": {
                    "byteLength": {
                      "exclusiveMinimum": 0,
                      "maximum": 26214400,
                      "type": "integer"
                    },
                    "digest": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 100000,
                      "type": "integer"
                    },
                    "mimeType": {
                      "const": "image/png",
                      "type": "string"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 100000,
                      "type": "integer"
                    }
                  },
                  "required": [
                    "digest",
                    "mimeType",
                    "byteLength",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "fullWindowScreenshot": {
                  "additionalProperties": false,
                  "properties": {
                    "byteLength": {
                      "exclusiveMinimum": 0,
                      "maximum": 26214400,
                      "type": "integer"
                    },
                    "digest": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 100000,
                      "type": "integer"
                    },
                    "mimeType": {
                      "const": "image/png",
                      "type": "string"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 100000,
                      "type": "integer"
                    }
                  },
                  "required": [
                    "digest",
                    "mimeType",
                    "byteLength",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "locale": {
                  "maxLength": 64,
                  "type": "string"
                },
                "osVersion": {
                  "maxLength": 128,
                  "type": "string"
                },
                "platform": {
                  "maxLength": 64,
                  "minLength": 1,
                  "type": "string"
                },
                "redacted": {
                  "type": "boolean"
                },
                "route": {
                  "maxLength": 512,
                  "type": "string"
                },
                "targetBounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    },
                    "x": {
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "targetLabel": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "theme": {
                  "maxLength": 64,
                  "type": "string"
                },
                "unavailableReason": {
                  "maxLength": 1000,
                  "type": "string"
                },
                "viewport": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    },
                    "scaleFactor": {
                      "exclusiveMinimum": 0,
                      "maximum": 16,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "width",
                    "height",
                    "scaleFactor"
                  ],
                  "type": "object"
                }
              },
              "required": [
                "capturedAt",
                "appVersion",
                "platform",
                "viewport",
                "targetLabel",
                "targetBounds"
              ],
              "type": "object"
            },
            "createdAt": {
              "maxLength": 64,
              "minLength": 1,
              "type": "string"
            },
            "feedback": {
              "additionalProperties": false,
              "properties": {
                "disclosure": {
                  "additionalProperties": false,
                  "properties": {
                    "annotatedScreenshots": {
                      "type": "boolean"
                    },
                    "applicationEnvironment": {
                      "type": "boolean"
                    },
                    "conversationExcerpt": {
                      "type": "boolean"
                    },
                    "fileMetadata": {
                      "type": "boolean"
                    },
                    "logs": {
                      "type": "boolean"
                    },
                    "workspacePaths": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "annotatedScreenshots",
                    "applicationEnvironment",
                    "logs",
                    "conversationExcerpt",
                    "workspacePaths",
                    "fileMetadata"
                  ],
                  "type": "object"
                },
                "error": {
                  "maxLength": 2000,
                  "type": "string"
                },
                "idempotencyKey": {
                  "maxLength": 256,
                  "type": "string"
                },
                "issue": {
                  "additionalProperties": false,
                  "properties": {
                    "assetUrls": {
                      "items": {
                        "format": "uri",
                        "maxLength": 2048,
                        "type": "string"
                      },
                      "maxItems": 16,
                      "type": "array"
                    },
                    "author": {
                      "maxLength": 256,
                      "type": "string"
                    },
                    "issueNumber": {
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991,
                      "type": "integer"
                    },
                    "issueUrl": {
                      "format": "uri",
                      "maxLength": 2048,
                      "type": "string"
                    },
                    "submittedAt": {
                      "maxLength": 64,
                      "minLength": 1,
                      "type": "string"
                    }
                  },
                  "required": [
                    "issueNumber",
                    "issueUrl",
                    "assetUrls",
                    "submittedAt"
                  ],
                  "type": "object"
                },
                "state": {
                  "enum": [
                    "local",
                    "submitting",
                    "submitted",
                    "failed"
                  ],
                  "type": "string"
                },
                "updatedAt": {
                  "maxLength": 64,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "state"
              ],
              "type": "object"
            },
            "id": {
              "maxLength": 256,
              "minLength": 1,
              "type": "string"
            },
            "messages": {
              "items": {
                "additionalProperties": false,
                "properties": {
                  "authorId": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "authorKind": {
                    "enum": [
                      "user",
                      "ai",
                      "system"
                    ],
                    "type": "string"
                  },
                  "body": {
                    "maxLength": 20000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "createdAt": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  },
                  "id": {
                    "maxLength": 256,
                    "minLength": 1,
                    "type": "string"
                  },
                  "updatedAt": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "authorKind",
                  "body",
                  "createdAt",
                  "updatedAt"
                ],
                "type": "object"
              },
              "maxItems": 500,
              "minItems": 1,
              "type": "array"
            },
            "purpose": {
              "enum": [
                "research",
                "product_feedback"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "const": 1,
              "type": "number"
            },
            "status": {
              "enum": [
                "open",
                "attached",
                "ai_responded",
                "awaiting_verification",
                "resolved"
              ],
              "type": "string"
            },
            "updatedAt": {
              "maxLength": 64,
              "minLength": 1,
              "type": "string"
            },
            "workspaceKey": {
              "maxLength": 2048,
              "minLength": 1,
              "type": "string"
            }
          },
          "required": [
            "schemaVersion",
            "id",
            "workspaceKey",
            "purpose",
            "anchor",
            "capture",
            "messages",
            "status",
            "anchorResolution",
            "feedback",
            "createdAt",
            "updatedAt"
          ],
          "type": "object"
        },
        "maxItems": 100000,
        "type": "array"
      }
    },
    "required": [
      "threads"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "List anchored comments"
}
```

## `anchored-comments.upsert`

Persists one validated comment thread and immutable evidence references.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `workspace-write`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "thread": {
        "additionalProperties": false,
        "properties": {
          "anchor": {
            "additionalProperties": false,
            "properties": {
              "bounds": {
                "additionalProperties": false,
                "properties": {
                  "height": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "x": {
                    "minimum": 0,
                    "type": "number"
                  },
                  "y": {
                    "minimum": 0,
                    "type": "number"
                  }
                },
                "required": [
                  "x",
                  "y",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "canonical": {
                "oneOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "contentDigest": {
                        "maxLength": 256,
                        "type": "string"
                      },
                      "kind": {
                        "const": "research",
                        "type": "string"
                      },
                      "resourceId": {
                        "maxLength": 2048,
                        "minLength": 1,
                        "type": "string"
                      },
                      "resourceKind": {
                        "maxLength": 128,
                        "minLength": 1,
                        "type": "string"
                      },
                      "selection": {
                        "additionalProperties": {
                          "anyOf": [
                            {
                              "anyOf": [
                                {
                                  "maxLength": 4096,
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                },
                                {
                                  "type": "boolean"
                                },
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            {
                              "items": {
                                "anyOf": [
                                  {
                                    "maxLength": 4096,
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  },
                                  {
                                    "type": "boolean"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "maxItems": 64,
                              "type": "array"
                            }
                          ]
                        },
                        "propertyNames": {
                          "maxLength": 128,
                          "minLength": 1,
                          "type": "string"
                        },
                        "type": "object"
                      }
                    },
                    "required": [
                      "kind",
                      "resourceKind",
                      "resourceId"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "componentId": {
                        "maxLength": 256,
                        "minLength": 1,
                        "type": "string"
                      },
                      "elementId": {
                        "maxLength": 256,
                        "type": "string"
                      },
                      "kind": {
                        "const": "ui",
                        "type": "string"
                      },
                      "route": {
                        "maxLength": 512,
                        "type": "string"
                      },
                      "selection": {
                        "additionalProperties": {
                          "anyOf": [
                            {
                              "anyOf": [
                                {
                                  "maxLength": 4096,
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                },
                                {
                                  "type": "boolean"
                                },
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            {
                              "items": {
                                "anyOf": [
                                  {
                                    "maxLength": 4096,
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  },
                                  {
                                    "type": "boolean"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "maxItems": 64,
                              "type": "array"
                            }
                          ]
                        },
                        "propertyNames": {
                          "maxLength": 128,
                          "minLength": 1,
                          "type": "string"
                        },
                        "type": "object"
                      }
                    },
                    "required": [
                      "kind",
                      "componentId"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "const": "visual",
                        "type": "string"
                      },
                      "route": {
                        "maxLength": 512,
                        "type": "string"
                      },
                      "selection": {
                        "additionalProperties": {
                          "anyOf": [
                            {
                              "anyOf": [
                                {
                                  "maxLength": 4096,
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                },
                                {
                                  "type": "boolean"
                                },
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            {
                              "items": {
                                "anyOf": [
                                  {
                                    "maxLength": 4096,
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  },
                                  {
                                    "type": "boolean"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "maxItems": 64,
                              "type": "array"
                            }
                          ]
                        },
                        "propertyNames": {
                          "maxLength": 128,
                          "minLength": 1,
                          "type": "string"
                        },
                        "type": "object"
                      }
                    },
                    "required": [
                      "kind"
                    ],
                    "type": "object"
                  }
                ]
              },
              "domFingerprint": {
                "additionalProperties": false,
                "properties": {
                  "accessibleName": {
                    "maxLength": 512,
                    "type": "string"
                  },
                  "commentId": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "path": {
                    "items": {
                      "additionalProperties": false,
                      "properties": {
                        "classes": {
                          "items": {
                            "maxLength": 128,
                            "minLength": 1,
                            "type": "string"
                          },
                          "maxItems": 8,
                          "type": "array"
                        },
                        "id": {
                          "maxLength": 256,
                          "type": "string"
                        },
                        "nthOfType": {
                          "exclusiveMinimum": 0,
                          "maximum": 10000,
                          "type": "integer"
                        },
                        "tagName": {
                          "maxLength": 64,
                          "minLength": 1,
                          "type": "string"
                        }
                      },
                      "required": [
                        "tagName"
                      ],
                      "type": "object"
                    },
                    "maxItems": 12,
                    "type": "array"
                  },
                  "role": {
                    "maxLength": 128,
                    "type": "string"
                  },
                  "tagName": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  },
                  "testId": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "visibleText": {
                    "maxLength": 1000,
                    "type": "string"
                  }
                },
                "required": [
                  "tagName"
                ],
                "type": "object"
              },
              "targetKey": {
                "maxLength": 2048,
                "minLength": 1,
                "type": "string"
              },
              "targetLabel": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "targetKey",
              "targetLabel",
              "canonical",
              "bounds"
            ],
            "type": "object"
          },
          "anchorResolution": {
            "enum": [
              "resolved",
              "needs_retargeting"
            ],
            "type": "string"
          },
          "capture": {
            "additionalProperties": false,
            "properties": {
              "appBuild": {
                "maxLength": 128,
                "type": "string"
              },
              "appVersion": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "capturedAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "contentDigest": {
                "maxLength": 256,
                "type": "string"
              },
              "focusedScreenshot": {
                "additionalProperties": false,
                "properties": {
                  "byteLength": {
                    "exclusiveMinimum": 0,
                    "maximum": 26214400,
                    "type": "integer"
                  },
                  "digest": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "mimeType": {
                    "const": "image/png",
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  }
                },
                "required": [
                  "digest",
                  "mimeType",
                  "byteLength",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "fullWindowScreenshot": {
                "additionalProperties": false,
                "properties": {
                  "byteLength": {
                    "exclusiveMinimum": 0,
                    "maximum": 26214400,
                    "type": "integer"
                  },
                  "digest": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "mimeType": {
                    "const": "image/png",
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  }
                },
                "required": [
                  "digest",
                  "mimeType",
                  "byteLength",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "locale": {
                "maxLength": 64,
                "type": "string"
              },
              "osVersion": {
                "maxLength": 128,
                "type": "string"
              },
              "platform": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "redacted": {
                "type": "boolean"
              },
              "route": {
                "maxLength": 512,
                "type": "string"
              },
              "targetBounds": {
                "additionalProperties": false,
                "properties": {
                  "height": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "x": {
                    "minimum": 0,
                    "type": "number"
                  },
                  "y": {
                    "minimum": 0,
                    "type": "number"
                  }
                },
                "required": [
                  "x",
                  "y",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "targetLabel": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "theme": {
                "maxLength": 64,
                "type": "string"
              },
              "unavailableReason": {
                "maxLength": 1000,
                "type": "string"
              },
              "viewport": {
                "additionalProperties": false,
                "properties": {
                  "height": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "scaleFactor": {
                    "exclusiveMinimum": 0,
                    "maximum": 16,
                    "type": "number"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  }
                },
                "required": [
                  "width",
                  "height",
                  "scaleFactor"
                ],
                "type": "object"
              }
            },
            "required": [
              "capturedAt",
              "appVersion",
              "platform",
              "viewport",
              "targetLabel",
              "targetBounds"
            ],
            "type": "object"
          },
          "createdAt": {
            "maxLength": 64,
            "minLength": 1,
            "type": "string"
          },
          "feedback": {
            "additionalProperties": false,
            "properties": {
              "disclosure": {
                "additionalProperties": false,
                "properties": {
                  "annotatedScreenshots": {
                    "type": "boolean"
                  },
                  "applicationEnvironment": {
                    "type": "boolean"
                  },
                  "conversationExcerpt": {
                    "type": "boolean"
                  },
                  "fileMetadata": {
                    "type": "boolean"
                  },
                  "logs": {
                    "type": "boolean"
                  },
                  "workspacePaths": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "annotatedScreenshots",
                  "applicationEnvironment",
                  "logs",
                  "conversationExcerpt",
                  "workspacePaths",
                  "fileMetadata"
                ],
                "type": "object"
              },
              "error": {
                "maxLength": 2000,
                "type": "string"
              },
              "idempotencyKey": {
                "maxLength": 256,
                "type": "string"
              },
              "issue": {
                "additionalProperties": false,
                "properties": {
                  "assetUrls": {
                    "items": {
                      "format": "uri",
                      "maxLength": 2048,
                      "type": "string"
                    },
                    "maxItems": 16,
                    "type": "array"
                  },
                  "author": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "issueNumber": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "issueUrl": {
                    "format": "uri",
                    "maxLength": 2048,
                    "type": "string"
                  },
                  "submittedAt": {
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "issueNumber",
                  "issueUrl",
                  "assetUrls",
                  "submittedAt"
                ],
                "type": "object"
              },
              "state": {
                "enum": [
                  "local",
                  "submitting",
                  "submitted",
                  "failed"
                ],
                "type": "string"
              },
              "updatedAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "state"
            ],
            "type": "object"
          },
          "id": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "messages": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "authorId": {
                  "maxLength": 256,
                  "type": "string"
                },
                "authorKind": {
                  "enum": [
                    "user",
                    "ai",
                    "system"
                  ],
                  "type": "string"
                },
                "body": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "createdAt": {
                  "maxLength": 64,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 256,
                  "minLength": 1,
                  "type": "string"
                },
                "updatedAt": {
                  "maxLength": 64,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "authorKind",
                "body",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 500,
            "minItems": 1,
            "type": "array"
          },
          "purpose": {
            "enum": [
              "research",
              "product_feedback"
            ],
            "type": "string"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "status": {
            "enum": [
              "open",
              "attached",
              "ai_responded",
              "awaiting_verification",
              "resolved"
            ],
            "type": "string"
          },
          "updatedAt": {
            "maxLength": 64,
            "minLength": 1,
            "type": "string"
          },
          "workspaceKey": {
            "maxLength": 2048,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "id",
          "workspaceKey",
          "purpose",
          "anchor",
          "capture",
          "messages",
          "status",
          "anchorResolution",
          "feedback",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      }
    },
    "required": [
      "thread"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "anchor": {
        "additionalProperties": false,
        "properties": {
          "bounds": {
            "additionalProperties": false,
            "properties": {
              "height": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "x": {
                "minimum": 0,
                "type": "number"
              },
              "y": {
                "minimum": 0,
                "type": "number"
              }
            },
            "required": [
              "x",
              "y",
              "width",
              "height"
            ],
            "type": "object"
          },
          "canonical": {
            "oneOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "contentDigest": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "kind": {
                    "const": "research",
                    "type": "string"
                  },
                  "resourceId": {
                    "maxLength": 2048,
                    "minLength": 1,
                    "type": "string"
                  },
                  "resourceKind": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  },
                  "selection": {
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "anyOf": [
                            {
                              "maxLength": 4096,
                              "type": "string"
                            },
                            {
                              "type": "number"
                            },
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        {
                          "items": {
                            "anyOf": [
                              {
                                "maxLength": 4096,
                                "type": "string"
                              },
                              {
                                "type": "number"
                              },
                              {
                                "type": "boolean"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "maxItems": 64,
                          "type": "array"
                        }
                      ]
                    },
                    "propertyNames": {
                      "maxLength": 128,
                      "minLength": 1,
                      "type": "string"
                    },
                    "type": "object"
                  }
                },
                "required": [
                  "kind",
                  "resourceKind",
                  "resourceId"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "componentId": {
                    "maxLength": 256,
                    "minLength": 1,
                    "type": "string"
                  },
                  "elementId": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "kind": {
                    "const": "ui",
                    "type": "string"
                  },
                  "route": {
                    "maxLength": 512,
                    "type": "string"
                  },
                  "selection": {
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "anyOf": [
                            {
                              "maxLength": 4096,
                              "type": "string"
                            },
                            {
                              "type": "number"
                            },
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        {
                          "items": {
                            "anyOf": [
                              {
                                "maxLength": 4096,
                                "type": "string"
                              },
                              {
                                "type": "number"
                              },
                              {
                                "type": "boolean"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "maxItems": 64,
                          "type": "array"
                        }
                      ]
                    },
                    "propertyNames": {
                      "maxLength": 128,
                      "minLength": 1,
                      "type": "string"
                    },
                    "type": "object"
                  }
                },
                "required": [
                  "kind",
                  "componentId"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "kind": {
                    "const": "visual",
                    "type": "string"
                  },
                  "route": {
                    "maxLength": 512,
                    "type": "string"
                  },
                  "selection": {
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "anyOf": [
                            {
                              "maxLength": 4096,
                              "type": "string"
                            },
                            {
                              "type": "number"
                            },
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        {
                          "items": {
                            "anyOf": [
                              {
                                "maxLength": 4096,
                                "type": "string"
                              },
                              {
                                "type": "number"
                              },
                              {
                                "type": "boolean"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "maxItems": 64,
                          "type": "array"
                        }
                      ]
                    },
                    "propertyNames": {
                      "maxLength": 128,
                      "minLength": 1,
                      "type": "string"
                    },
                    "type": "object"
                  }
                },
                "required": [
                  "kind"
                ],
                "type": "object"
              }
            ]
          },
          "domFingerprint": {
            "additionalProperties": false,
            "properties": {
              "accessibleName": {
                "maxLength": 512,
                "type": "string"
              },
              "commentId": {
                "maxLength": 256,
                "type": "string"
              },
              "path": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "classes": {
                      "items": {
                        "maxLength": 128,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxItems": 8,
                      "type": "array"
                    },
                    "id": {
                      "maxLength": 256,
                      "type": "string"
                    },
                    "nthOfType": {
                      "exclusiveMinimum": 0,
                      "maximum": 10000,
                      "type": "integer"
                    },
                    "tagName": {
                      "maxLength": 64,
                      "minLength": 1,
                      "type": "string"
                    }
                  },
                  "required": [
                    "tagName"
                  ],
                  "type": "object"
                },
                "maxItems": 12,
                "type": "array"
              },
              "role": {
                "maxLength": 128,
                "type": "string"
              },
              "tagName": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "testId": {
                "maxLength": 256,
                "type": "string"
              },
              "visibleText": {
                "maxLength": 1000,
                "type": "string"
              }
            },
            "required": [
              "tagName"
            ],
            "type": "object"
          },
          "targetKey": {
            "maxLength": 2048,
            "minLength": 1,
            "type": "string"
          },
          "targetLabel": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "targetKey",
          "targetLabel",
          "canonical",
          "bounds"
        ],
        "type": "object"
      },
      "anchorResolution": {
        "enum": [
          "resolved",
          "needs_retargeting"
        ],
        "type": "string"
      },
      "capture": {
        "additionalProperties": false,
        "properties": {
          "appBuild": {
            "maxLength": 128,
            "type": "string"
          },
          "appVersion": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "capturedAt": {
            "maxLength": 64,
            "minLength": 1,
            "type": "string"
          },
          "contentDigest": {
            "maxLength": 256,
            "type": "string"
          },
          "focusedScreenshot": {
            "additionalProperties": false,
            "properties": {
              "byteLength": {
                "exclusiveMinimum": 0,
                "maximum": 26214400,
                "type": "integer"
              },
              "digest": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              },
              "mimeType": {
                "const": "image/png",
                "type": "string"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              }
            },
            "required": [
              "digest",
              "mimeType",
              "byteLength",
              "width",
              "height"
            ],
            "type": "object"
          },
          "fullWindowScreenshot": {
            "additionalProperties": false,
            "properties": {
              "byteLength": {
                "exclusiveMinimum": 0,
                "maximum": 26214400,
                "type": "integer"
              },
              "digest": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              },
              "mimeType": {
                "const": "image/png",
                "type": "string"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              }
            },
            "required": [
              "digest",
              "mimeType",
              "byteLength",
              "width",
              "height"
            ],
            "type": "object"
          },
          "locale": {
            "maxLength": 64,
            "type": "string"
          },
          "osVersion": {
            "maxLength": 128,
            "type": "string"
          },
          "platform": {
            "maxLength": 64,
            "minLength": 1,
            "type": "string"
          },
          "redacted": {
            "type": "boolean"
          },
          "route": {
            "maxLength": 512,
            "type": "string"
          },
          "targetBounds": {
            "additionalProperties": false,
            "properties": {
              "height": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "x": {
                "minimum": 0,
                "type": "number"
              },
              "y": {
                "minimum": 0,
                "type": "number"
              }
            },
            "required": [
              "x",
              "y",
              "width",
              "height"
            ],
            "type": "object"
          },
          "targetLabel": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "theme": {
            "maxLength": 64,
            "type": "string"
          },
          "unavailableReason": {
            "maxLength": 1000,
            "type": "string"
          },
          "viewport": {
            "additionalProperties": false,
            "properties": {
              "height": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "scaleFactor": {
                "exclusiveMinimum": 0,
                "maximum": 16,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "scaleFactor"
            ],
            "type": "object"
          }
        },
        "required": [
          "capturedAt",
          "appVersion",
          "platform",
          "viewport",
          "targetLabel",
          "targetBounds"
        ],
        "type": "object"
      },
      "createdAt": {
        "maxLength": 64,
        "minLength": 1,
        "type": "string"
      },
      "feedback": {
        "additionalProperties": false,
        "properties": {
          "disclosure": {
            "additionalProperties": false,
            "properties": {
              "annotatedScreenshots": {
                "type": "boolean"
              },
              "applicationEnvironment": {
                "type": "boolean"
              },
              "conversationExcerpt": {
                "type": "boolean"
              },
              "fileMetadata": {
                "type": "boolean"
              },
              "logs": {
                "type": "boolean"
              },
              "workspacePaths": {
                "type": "boolean"
              }
            },
            "required": [
              "annotatedScreenshots",
              "applicationEnvironment",
              "logs",
              "conversationExcerpt",
              "workspacePaths",
              "fileMetadata"
            ],
            "type": "object"
          },
          "error": {
            "maxLength": 2000,
            "type": "string"
          },
          "idempotencyKey": {
            "maxLength": 256,
            "type": "string"
          },
          "issue": {
            "additionalProperties": false,
            "properties": {
              "assetUrls": {
                "items": {
                  "format": "uri",
                  "maxLength": 2048,
                  "type": "string"
                },
                "maxItems": 16,
                "type": "array"
              },
              "author": {
                "maxLength": 256,
                "type": "string"
              },
              "issueNumber": {
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991,
                "type": "integer"
              },
              "issueUrl": {
                "format": "uri",
                "maxLength": 2048,
                "type": "string"
              },
              "submittedAt": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "issueNumber",
              "issueUrl",
              "assetUrls",
              "submittedAt"
            ],
            "type": "object"
          },
          "state": {
            "enum": [
              "local",
              "submitting",
              "submitted",
              "failed"
            ],
            "type": "string"
          },
          "updatedAt": {
            "maxLength": 64,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "state"
        ],
        "type": "object"
      },
      "id": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "messages": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "authorId": {
              "maxLength": 256,
              "type": "string"
            },
            "authorKind": {
              "enum": [
                "user",
                "ai",
                "system"
              ],
              "type": "string"
            },
            "body": {
              "maxLength": 20000,
              "minLength": 1,
              "type": "string"
            },
            "createdAt": {
              "maxLength": 64,
              "minLength": 1,
              "type": "string"
            },
            "id": {
              "maxLength": 256,
              "minLength": 1,
              "type": "string"
            },
            "updatedAt": {
              "maxLength": 64,
              "minLength": 1,
              "type": "string"
            }
          },
          "required": [
            "id",
            "authorKind",
            "body",
            "createdAt",
            "updatedAt"
          ],
          "type": "object"
        },
        "maxItems": 500,
        "minItems": 1,
        "type": "array"
      },
      "purpose": {
        "enum": [
          "research",
          "product_feedback"
        ],
        "type": "string"
      },
      "schemaVersion": {
        "const": 1,
        "type": "number"
      },
      "status": {
        "enum": [
          "open",
          "attached",
          "ai_responded",
          "awaiting_verification",
          "resolved"
        ],
        "type": "string"
      },
      "updatedAt": {
        "maxLength": 64,
        "minLength": 1,
        "type": "string"
      },
      "workspaceKey": {
        "maxLength": 2048,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "schemaVersion",
      "id",
      "workspaceKey",
      "purpose",
      "anchor",
      "capture",
      "messages",
      "status",
      "anchorResolution",
      "feedback",
      "createdAt",
      "updatedAt"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "anchored-comments"
  ],
  "title": "Save anchored comment"
}
```

## `biology-room.apply`

Applies revisioned Biology Room operations using the canonical service.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "actor": {},
      "dryRun": {
        "type": "boolean"
      },
      "operations": {
        "items": {},
        "maxItems": 100,
        "minItems": 1,
        "type": "array"
      }
    },
    "required": [
      "operations"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "biology-room"
  ],
  "tags": [
    "biology",
    "room",
    "edit"
  ],
  "title": "Apply Biology Room operations"
}
```

## `biology-room.create`

Creates a Biology Room in the caller workspace and returns a scoped resource handle.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "actor": {},
      "assets": {
        "items": {},
        "maxItems": 128,
        "type": "array"
      },
      "roomId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "title": {
        "maxLength": 300,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "title"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "biology",
    "room",
    "create"
  ],
  "title": "Create Biology Room"
}
```

## `biology-room.history`

Returns bounded revision history for the current Biology Room.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "beforeRevision": {
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991,
        "type": "integer"
      },
      "limit": {
        "default": 50,
        "maximum": 100,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": [
      "limit"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "biology-room"
  ],
  "tags": [
    "biology",
    "room",
    "history"
  ],
  "title": "Read Biology Room history"
}
```

## `biology-room.list`

Lists Biology Rooms in the caller workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "limit": {
        "default": 100,
        "maximum": 500,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": [
      "limit"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "biology",
    "room",
    "discovery"
  ],
  "title": "List Biology Rooms"
}
```

## `biology-room.load`

Loads a Biology Room manifest and returns its scoped resource handle.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "roomId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "roomId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "biology",
    "room",
    "load"
  ],
  "title": "Load Biology Room"
}
```

## `biology-room.open`

Observes a Biology Room and returns a scoped resource handle.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "annotationLimit": {
        "default": 50,
        "maximum": 200,
        "minimum": 1,
        "type": "integer"
      },
      "assetLimit": {
        "default": 32,
        "maximum": 128,
        "minimum": 1,
        "type": "integer"
      },
      "contigLimit": {
        "default": 50,
        "maximum": 500,
        "minimum": 1,
        "type": "integer"
      },
      "roomId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "roomId",
      "assetLimit",
      "annotationLimit",
      "contigLimit"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "biology",
    "room"
  ],
  "title": "Open Biology Room resource"
}
```

## `biology-room.open-or-create`

Opens the room for a workspace biology asset, creating it when needed.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "actor": {},
      "asReference": {
        "type": "boolean"
      },
      "expectedSha256": {
        "pattern": "^[a-f0-9]{64}$",
        "type": "string"
      },
      "format": {
        "enum": [
          "fasta",
          "genbank",
          "pdb",
          "mmcif",
          "gff3",
          "bed",
          "vcf"
        ],
        "type": "string"
      },
      "indexPaths": {
        "items": {
          "maxLength": 4096,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 4,
        "type": "array"
      },
      "path": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "referenceAssetId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 300,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "path"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "biology",
    "room",
    "open"
  ],
  "title": "Open or create Biology Room"
}
```

## `biology-room.refresh`

Refreshes source-backed assets in the current Biology Room.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "actor": {}
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "biology-room"
  ],
  "tags": [
    "biology",
    "room",
    "refresh"
  ],
  "title": "Refresh Biology Room assets"
}
```

## `browser-preview.back`

Moves the canonical browser page backward in history.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Go back in browser page"
}
```

## `browser-preview.click`

Clicks one revision-bound target or one viewport point.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `destructive`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "additionalProperties": false,
        "properties": {
          "targetRef": {
            "pattern": "^target_[A-Za-z0-9_-]{20,}$",
            "type": "string"
          }
        },
        "required": [
          "targetRef"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "x": {
            "maximum": 4096,
            "minimum": 0,
            "type": "number"
          },
          "y": {
            "maximum": 4096,
            "minimum": 0,
            "type": "number"
          }
        },
        "required": [
          "x",
          "y"
        ],
        "type": "object"
      }
    ]
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Click browser page target"
}
```

## `browser-preview.fill`

Replaces a non-password field through a revision-bound target.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "targetRef": {
        "pattern": "^target_[A-Za-z0-9_-]{20,}$",
        "type": "string"
      },
      "text": {
        "maxLength": 20000,
        "type": "string"
      }
    },
    "required": [
      "targetRef",
      "text"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Edit browser page field"
}
```

## `browser-preview.forward`

Moves the canonical browser page forward in history.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Go forward in browser page"
}
```

## `browser-preview.navigate`

Navigates the page to one explicit HTTP(S) URL.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "url": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "url"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Navigate browser page"
}
```

## `browser-preview.open`

Creates the canonical Playwright page for a visible SciForge browser panel.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "sessionId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "url": {
        "default": "http://localhost:5173/",
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "sessionId",
      "url"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "resource": {
        "additionalProperties": false,
        "properties": {
          "expiresAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "semanticRevision": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "token": {
            "pattern": "^cap_[A-Za-z0-9_-]{20,}$",
            "type": "string"
          }
        },
        "required": [
          "token",
          "semanticRevision",
          "expiresAt"
        ],
        "type": "object"
      },
      "sessionId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "resource",
      "sessionId"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "browser",
    "playwright",
    "bootstrap"
  ],
  "title": "Open Playwright browser page"
}
```

## `browser-preview.press`

Presses one allowlisted key through a revision-bound target.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `destructive`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "key": {
        "enum": [
          "Enter",
          "Tab",
          "Escape",
          "Backspace",
          "Delete",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown",
          "Space"
        ],
        "type": "string"
      },
      "targetRef": {
        "pattern": "^target_[A-Za-z0-9_-]{20,}$",
        "type": "string"
      }
    },
    "required": [
      "targetRef",
      "key"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Press key on browser page target"
}
```

## `browser-preview.read`

Reads a bounded accessibility snapshot. Page content is untrusted data.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ariaSnapshot": {
        "maxLength": 60000,
        "type": "string"
      },
      "canGoBack": {
        "type": "boolean"
      },
      "canGoForward": {
        "type": "boolean"
      },
      "error": {
        "anyOf": [
          {
            "maxLength": 2000,
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "safetyNotice": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string"
      },
      "screenshotDataUrl": {
        "maxLength": 4000000,
        "type": "string"
      },
      "sessionId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "status": {
        "enum": [
          "starting",
          "ready",
          "loading",
          "error",
          "closed"
        ],
        "type": "string"
      },
      "targets": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "targetRef": {
              "pattern": "^target_[A-Za-z0-9_-]{20,}$",
              "type": "string"
            }
          },
          "required": [
            "targetRef"
          ],
          "type": "object"
        },
        "maxItems": 512,
        "type": "array"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "truncated": {
        "type": "boolean"
      },
      "trust": {
        "const": "untrusted-web-content",
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      },
      "viewport": {
        "additionalProperties": false,
        "properties": {
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 4096,
            "type": "integer"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 4096,
            "type": "integer"
          }
        },
        "required": [
          "width",
          "height"
        ],
        "type": "object"
      }
    },
    "required": [
      "trust",
      "safetyNotice",
      "sessionId",
      "url",
      "title",
      "status",
      "error",
      "canGoBack",
      "canGoForward",
      "viewport",
      "ariaSnapshot",
      "targets",
      "truncated"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Read browser page"
}
```

## `browser-preview.reload`

Reloads the canonical browser page.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Reload browser page"
}
```

## `browser-preview.select`

Selects an option through a revision-bound target.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "targetRef": {
        "pattern": "^target_[A-Za-z0-9_-]{20,}$",
        "type": "string"
      },
      "value": {
        "maxLength": 2000,
        "type": "string"
      }
    },
    "required": [
      "targetRef",
      "value"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "semanticRevision": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "title": {
        "maxLength": 1024,
        "type": "string"
      },
      "url": {
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "url",
      "title",
      "semanticRevision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "browser-page"
  ],
  "tags": [
    "browser",
    "playwright",
    "web-page"
  ],
  "title": "Select browser page option"
}
```

## `change-inspector.open-session`

Issues a read-only resource for one session change snapshot.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "runtimeId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "sessionId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "sessionId",
      "runtimeId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "resource": {
        "additionalProperties": false,
        "properties": {
          "expiresAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "semanticRevision": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "token": {
            "pattern": "^cap_[A-Za-z0-9_-]{20,}$",
            "type": "string"
          }
        },
        "required": [
          "token",
          "semanticRevision",
          "expiresAt"
        ],
        "type": "object"
      },
      "sessionId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "resource",
      "sessionId"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "session",
    "changes",
    "diff",
    "audit"
  ],
  "title": "Observe session changes"
}
```

## `controlled-process.create`

Starts a host-controlled system shell inside the active workspace.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "cwd": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "profile": {
        "const": "system-shell",
        "type": "string"
      },
      "terminal": {
        "additionalProperties": false,
        "properties": {
          "columns": {
            "maximum": 1000,
            "minimum": 1,
            "type": "integer"
          },
          "rows": {
            "maximum": 1000,
            "minimum": 1,
            "type": "integer"
          }
        },
        "required": [
          "columns",
          "rows"
        ],
        "type": "object"
      }
    },
    "required": [
      "profile"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "cursor": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "resource": {
        "additionalProperties": false,
        "properties": {
          "expiresAt": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "semanticRevision": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "token": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "token",
          "semanticRevision",
          "expiresAt"
        ],
        "type": "object"
      },
      "resourceKind": {
        "const": "host.controlled-process",
        "type": "string"
      }
    },
    "required": [
      "resourceKind",
      "resource",
      "cursor"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "process",
    "terminal",
    "workspace"
  ],
  "title": "Create controlled process"
}
```

## `controlled-process.dispose`

Stops and releases an owned controlled process.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "reason": {
        "maxLength": 500,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      }
    },
    "required": [
      "ok"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.controlled-process"
  ],
  "tags": [
    "process",
    "terminal",
    "lifecycle"
  ],
  "title": "Dispose controlled process"
}
```

## `controlled-process.read`

Reads a bounded output stream from an owned controlled process.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "cursor": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "maxCharacters": {
        "maximum": 1000000,
        "minimum": 1,
        "type": "integer"
      },
      "waitMilliseconds": {
        "maximum": 30000,
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "cursor"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "chunks": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "data": {
              "maxLength": 1000000,
              "type": "string"
            },
            "stream": {
              "enum": [
                "stdout",
                "stderr"
              ],
              "type": "string"
            }
          },
          "required": [
            "stream",
            "data"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "cursor": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "exit": {
        "additionalProperties": false,
        "properties": {
          "code": {
            "anyOf": [
              {
                "maximum": 9007199254740991,
                "minimum": -9007199254740991,
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "signal": {
            "anyOf": [
              {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "code",
          "signal"
        ],
        "type": "object"
      },
      "truncated": {
        "type": "boolean"
      }
    },
    "required": [
      "cursor",
      "chunks",
      "truncated"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.controlled-process"
  ],
  "tags": [
    "process",
    "terminal",
    "stream"
  ],
  "title": "Read controlled process output"
}
```

## `controlled-process.resize`

Updates terminal dimensions for an owned controlled process.

- Version: `1.0.0`
- Audiences: ui
- Effect: `compute`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "columns": {
        "maximum": 1000,
        "minimum": 1,
        "type": "integer"
      },
      "rows": {
        "maximum": 1000,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": [
      "columns",
      "rows"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      }
    },
    "required": [
      "ok"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.controlled-process"
  ],
  "tags": [
    "process",
    "terminal",
    "layout"
  ],
  "title": "Resize controlled process terminal"
}
```

## `controlled-process.write`

Writes bounded input to an owned controlled process.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "data": {
        "maxLength": 100000,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "data"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "acceptedCharacters": {
        "maximum": 100000,
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "acceptedCharacters"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.controlled-process"
  ],
  "tags": [
    "process",
    "terminal",
    "input"
  ],
  "title": "Write controlled process input"
}
```

## `create-loop.check-code`

Checks JavaScript, Python, or Bash node syntax.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `compute`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "code": {
        "maxLength": 1000000,
        "type": "string"
      },
      "language": {
        "enum": [
          "javascript",
          "python",
          "bash"
        ],
        "type": "string"
      }
    },
    "required": [
      "language",
      "code"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "status": {
            "const": "ok",
            "type": "string"
          }
        },
        "required": [
          "status"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "status": {
            "const": "error",
            "type": "string"
          }
        },
        "required": [
          "status",
          "message"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "status": {
            "const": "unavailable",
            "type": "string"
          }
        },
        "required": [
          "status",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Check workflow code"
}
```

## `create-loop.export-dsl`

Exports one workflow as a portable Create Loop document with secrets removed.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "workflowId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workflowId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "dsl": {
        "type": "string"
      }
    },
    "required": [
      "dsl"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Export workflow DSL"
}
```

## `create-loop.import-dsl`

Validates and normalizes one portable Create Loop workflow document.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `compute`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "dsl": {
        "maxLength": 5000000,
        "type": "string"
      }
    },
    "required": [
      "dsl"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "allOf": [
      {
        "$ref": "#/definitions/__schema0"
      }
    ],
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    }
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Import workflow DSL"
}
```

## `create-loop.read`

Reads the canonical node workflow definitions and package revision.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "revision": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "settings": {
        "allOf": [
          {
            "$ref": "#/definitions/__schema0"
          }
        ]
      }
    },
    "required": [
      "revision",
      "settings"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Read Create Loop settings"
}
```

## `create-loop.resolve-approval`

Resolves a package-owned human approval pause.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "decision": {
        "enum": [
          "approved",
          "rejected"
        ],
        "type": "string"
      },
      "token": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "token",
      "decision"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "resolved": {
        "type": "boolean"
      }
    },
    "required": [
      "resolved"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Resolve workflow approval"
}
```

## `create-loop.run`

Runs one node workflow through the package-owned runtime.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "input": {
        "allOf": [
          {
            "$ref": "#/definitions/__schema0"
          }
        ]
      },
      "workflowId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workflowId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "runId": {
            "maxLength": 256,
            "type": "string"
          },
          "status": {
            "enum": [
              "idle",
              "running",
              "success",
              "error"
            ],
            "type": "string"
          }
        },
        "required": [
          "ok",
          "runId",
          "status",
          "message"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Run workflow"
}
```

## `create-loop.run-node`

Runs one node in the context of its persisted workflow.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "nodeId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "workflowId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workflowId",
      "nodeId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "runId": {
            "maxLength": 256,
            "type": "string"
          },
          "status": {
            "enum": [
              "idle",
              "running",
              "success",
              "error"
            ],
            "type": "string"
          }
        },
        "required": [
          "ok",
          "runId",
          "status",
          "message"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Run workflow node"
}
```

## `create-loop.save`

Atomically saves node workflows, modules, presets, hooks, and runtime settings.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "expectedRevision": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "settings": {
        "allOf": [
          {
            "$ref": "#/definitions/__schema0"
          }
        ]
      }
    },
    "required": [
      "settings"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "revision": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "settings": {
        "allOf": [
          {
            "$ref": "#/definitions/__schema0"
          }
        ]
      }
    },
    "required": [
      "revision",
      "settings"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Save Create Loop settings"
}
```

## `create-loop.status`

Reads active runs, node statuses, results, and pending approvals.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "nodeResults": {
        "additionalProperties": {
          "additionalProperties": {
            "additionalProperties": false,
            "properties": {
              "error": {
                "maxLength": 1000000,
                "type": "string"
              },
              "finishedAt": {
                "maxLength": 128,
                "type": "string"
              },
              "inputJson": {
                "maxLength": 5000000,
                "type": "string"
              },
              "message": {
                "maxLength": 1000000,
                "type": "string"
              },
              "nodeId": {
                "maxLength": 256,
                "type": "string"
              },
              "outputJson": {
                "maxLength": 5000000,
                "type": "string"
              },
              "retries": {
                "maximum": 9007199254740991,
                "minimum": 0,
                "type": "integer"
              },
              "startedAt": {
                "maxLength": 128,
                "type": "string"
              },
              "status": {
                "enum": [
                  "pending",
                  "running",
                  "success",
                  "error",
                  "skipped"
                ],
                "type": "string"
              },
              "threadId": {
                "maxLength": 512,
                "type": "string"
              }
            },
            "required": [
              "nodeId",
              "status",
              "startedAt",
              "finishedAt",
              "message",
              "outputJson",
              "threadId",
              "error"
            ],
            "type": "object"
          },
          "propertyNames": {
            "maxLength": 256,
            "type": "string"
          },
          "type": "object"
        },
        "propertyNames": {
          "maxLength": 256,
          "type": "string"
        },
        "type": "object"
      },
      "nodeStatus": {
        "additionalProperties": {
          "additionalProperties": {
            "enum": [
              "pending",
              "running",
              "success",
              "error",
              "skipped"
            ],
            "type": "string"
          },
          "propertyNames": {
            "maxLength": 256,
            "type": "string"
          },
          "type": "object"
        },
        "propertyNames": {
          "maxLength": 256,
          "type": "string"
        },
        "type": "object"
      },
      "pendingApprovals": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "createdAt": {
              "maxLength": 128,
              "type": "string"
            },
            "instruction": {
              "maxLength": 100000,
              "type": "string"
            },
            "nodeId": {
              "maxLength": 256,
              "type": "string"
            },
            "nodeName": {
              "maxLength": 500,
              "type": "string"
            },
            "runId": {
              "maxLength": 256,
              "type": "string"
            },
            "title": {
              "maxLength": 500,
              "type": "string"
            },
            "token": {
              "maxLength": 512,
              "type": "string"
            },
            "workflowId": {
              "maxLength": 256,
              "type": "string"
            }
          },
          "required": [
            "token",
            "workflowId",
            "runId",
            "nodeId",
            "nodeName",
            "title",
            "instruction",
            "createdAt"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "powerSaveBlockerActive": {
        "type": "boolean"
      },
      "runningWorkflowIds": {
        "items": {
          "maxLength": 256,
          "type": "string"
        },
        "maxItems": 10000,
        "type": "array"
      }
    },
    "required": [
      "runningWorkflowIds",
      "nodeStatus",
      "nodeResults",
      "powerSaveBlockerActive",
      "pendingApprovals"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Read workflow status"
}
```

## `create-loop.stop`

Stops one active workflow run and releases its pending operations.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "workflowId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workflowId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "runId": {
            "maxLength": 256,
            "type": "string"
          },
          "status": {
            "enum": [
              "idle",
              "running",
              "success",
              "error"
            ],
            "type": "string"
          }
        },
        "required": [
          "ok",
          "runId",
          "status",
          "message"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Stop workflow"
}
```

## `create-loop.test-node`

Executes one node against bounded mock JSON without adding run history.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `compute`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "mockJson": {
        "maxLength": 1000000,
        "type": "string"
      },
      "nodeId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "workflowId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workflowId",
      "nodeId",
      "mockJson"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "result": {
            "additionalProperties": false,
            "properties": {
              "error": {
                "maxLength": 1000000,
                "type": "string"
              },
              "finishedAt": {
                "maxLength": 128,
                "type": "string"
              },
              "inputJson": {
                "maxLength": 5000000,
                "type": "string"
              },
              "message": {
                "maxLength": 1000000,
                "type": "string"
              },
              "nodeId": {
                "maxLength": 256,
                "type": "string"
              },
              "outputJson": {
                "maxLength": 5000000,
                "type": "string"
              },
              "retries": {
                "maximum": 9007199254740991,
                "minimum": 0,
                "type": "integer"
              },
              "startedAt": {
                "maxLength": 128,
                "type": "string"
              },
              "status": {
                "enum": [
                  "pending",
                  "running",
                  "success",
                  "error",
                  "skipped"
                ],
                "type": "string"
              },
              "threadId": {
                "maxLength": 512,
                "type": "string"
              }
            },
            "required": [
              "nodeId",
              "status",
              "startedAt",
              "finishedAt",
              "message",
              "outputJson",
              "threadId",
              "error"
            ],
            "type": "object"
          }
        },
        "required": [
          "ok",
          "result"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "maxLength": 1000000,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "workflow",
    "automation",
    "loop"
  ],
  "title": "Test workflow node"
}
```

## `evidence-dag.priority`

Adjusts scheduling priority without creating another update path.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `compute`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "runtimeId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "visible": {
        "type": "boolean"
      }
    },
    "required": [
      "runtimeId",
      "threadId",
      "visible"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "committed": {
        "anyOf": [
          {
            "additionalProperties": false,
            "properties": {
              "artifactDigests": {
                "items": {
                  "pattern": "^sha256:[0-9a-f]{64}$",
                  "type": "string"
                },
                "maxItems": 10000,
                "type": "array"
              },
              "createdAt": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "digest": {
                "pattern": "^sha256:[0-9a-f]{64}$",
                "type": "string"
              },
              "extractorVersion": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "inputWatermark": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "schemaVersion": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "threadId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "url": {
                "format": "uri",
                "maxLength": 4096,
                "type": "string"
              },
              "verifierVersion": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "version": {
                "maximum": 9007199254740991,
                "minimum": 0,
                "type": "integer"
              }
            },
            "required": [
              "threadId",
              "version",
              "digest",
              "inputWatermark",
              "schemaVersion",
              "extractorVersion",
              "verifierVersion",
              "artifactDigests",
              "createdAt"
            ],
            "type": "object"
          },
          {
            "type": "null"
          }
        ]
      },
      "pending": {
        "anyOf": [
          {
            "oneOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "attempt": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "completedBatches": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "jobId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "state": {
                    "const": "queued",
                    "type": "string"
                  },
                  "targetWatermark": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "totalBatches": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "updatedAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  }
                },
                "required": [
                  "jobId",
                  "targetWatermark",
                  "attempt",
                  "createdAt",
                  "updatedAt",
                  "state"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "attempt": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "completedBatches": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "jobId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "phase": {
                    "enum": [
                      "capturing",
                      "extracting",
                      "verifying",
                      "committing",
                      "handoff"
                    ],
                    "type": "string"
                  },
                  "state": {
                    "const": "running",
                    "type": "string"
                  },
                  "targetWatermark": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "totalBatches": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "updatedAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  }
                },
                "required": [
                  "jobId",
                  "targetWatermark",
                  "attempt",
                  "createdAt",
                  "updatedAt",
                  "state",
                  "phase"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "attempt": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "completedBatches": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "error": {
                    "additionalProperties": false,
                    "properties": {
                      "attempts": {
                        "exclusiveMinimum": 0,
                        "maximum": 100,
                        "type": "integer"
                      },
                      "code": {
                        "enum": [
                          "model_output_incomplete",
                          "model_output_empty",
                          "model_output_invalid_json",
                          "upstream_timeout",
                          "upstream_rate_limited",
                          "upstream_unavailable",
                          "snapshot_corrupt",
                          "access_restricted",
                          "internal_error"
                        ],
                        "type": "string"
                      },
                      "incompleteReason": {
                        "maxLength": 256,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxOutputTokens": {
                        "exclusiveMinimum": 0,
                        "maximum": 1000000,
                        "type": "integer"
                      },
                      "message": {
                        "maxLength": 4000,
                        "minLength": 1,
                        "type": "string"
                      },
                      "occurredAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "requestId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "responseStatus": {
                        "maxLength": 256,
                        "minLength": 1,
                        "type": "string"
                      },
                      "retryable": {
                        "type": "boolean"
                      },
                      "upstreamStatus": {
                        "maximum": 599,
                        "minimum": 100,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "code",
                      "message",
                      "retryable",
                      "occurredAt"
                    ],
                    "type": "object"
                  },
                  "jobId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "nextAttemptAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "state": {
                    "const": "retrying",
                    "type": "string"
                  },
                  "targetWatermark": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "totalBatches": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "updatedAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  }
                },
                "required": [
                  "jobId",
                  "targetWatermark",
                  "attempt",
                  "createdAt",
                  "updatedAt",
                  "state",
                  "nextAttemptAt",
                  "error"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "attempt": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "completedBatches": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "error": {
                    "additionalProperties": false,
                    "properties": {
                      "attempts": {
                        "exclusiveMinimum": 0,
                        "maximum": 100,
                        "type": "integer"
                      },
                      "code": {
                        "enum": [
                          "model_output_incomplete",
                          "model_output_empty",
                          "model_output_invalid_json",
                          "upstream_timeout",
                          "upstream_rate_limited",
                          "upstream_unavailable",
                          "snapshot_corrupt",
                          "access_restricted",
                          "internal_error"
                        ],
                        "type": "string"
                      },
                      "incompleteReason": {
                        "maxLength": 256,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxOutputTokens": {
                        "exclusiveMinimum": 0,
                        "maximum": 1000000,
                        "type": "integer"
                      },
                      "message": {
                        "maxLength": 4000,
                        "minLength": 1,
                        "type": "string"
                      },
                      "occurredAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "requestId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "responseStatus": {
                        "maxLength": 256,
                        "minLength": 1,
                        "type": "string"
                      },
                      "retryable": {
                        "type": "boolean"
                      },
                      "upstreamStatus": {
                        "maximum": 599,
                        "minimum": 100,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "code",
                      "message",
                      "retryable",
                      "occurredAt"
                    ],
                    "type": "object"
                  },
                  "jobId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "state": {
                    "const": "failed",
                    "type": "string"
                  },
                  "targetWatermark": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "totalBatches": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "updatedAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  }
                },
                "required": [
                  "jobId",
                  "targetWatermark",
                  "attempt",
                  "createdAt",
                  "updatedAt",
                  "state",
                  "error"
                ],
                "type": "object"
              }
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "updatedAt": {
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
        "type": "string"
      }
    },
    "required": [
      "committed",
      "pending",
      "updatedAt"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "evidence",
    "dag",
    "provenance"
  ],
  "title": "Set Evidence DAG priority"
}
```

## `evidence-dag.resolve-evidence-preview`

Resolves a pinned provenance tuple to a verified workspace-local file.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "artifactVersionId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "runtimeId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "snapshotDigest": {
        "pattern": "^sha256:[0-9a-f]{64}$",
        "type": "string"
      },
      "sourceAnchorId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "sourceAssertionId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "runtimeId",
      "threadId",
      "snapshotDigest",
      "sourceAssertionId",
      "artifactVersionId",
      "sourceAnchorId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "anchorDigest": {
            "pattern": "^sha256:[0-9a-f]{64}$",
            "type": "string"
          },
          "artifactId": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "artifactVersionId": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "contentDigest": {
            "pattern": "^sha256:[0-9a-f]{64}$",
            "type": "string"
          },
          "mediaType": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "path": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "runtimeId": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "selector": {
            "additionalProperties": false,
            "properties": {
              "columnNames": {
                "items": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              },
              "figure": {
                "maxLength": 1000,
                "minLength": 1,
                "type": "string"
              },
              "lineRange": {
                "maxLength": 1000,
                "minLength": 1,
                "type": "string"
              },
              "page": {
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991,
                "type": "integer"
              },
              "query": {
                "additionalProperties": {},
                "propertyNames": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "type": "object"
              },
              "quote": {
                "maxLength": 20000,
                "type": "string"
              },
              "rowRange": {
                "maxLength": 1000,
                "minLength": 1,
                "type": "string"
              },
              "section": {
                "maxLength": 1000,
                "minLength": 1,
                "type": "string"
              },
              "table": {
                "maxLength": 1000,
                "minLength": 1,
                "type": "string"
              },
              "type": {
                "enum": [
                  "pdf",
                  "text",
                  "table",
                  "figure",
                  "code",
                  "dataset",
                  "web"
                ],
                "type": "string"
              }
            },
            "required": [
              "type"
            ],
            "type": "object"
          },
          "snapshotDigest": {
            "pattern": "^sha256:[0-9a-f]{64}$",
            "type": "string"
          },
          "sourceAnchorId": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "sourceAssertionId": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "threadId": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "workspaceRoot": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "ok",
          "path",
          "workspaceRoot",
          "runtimeId",
          "threadId",
          "snapshotDigest",
          "sourceAssertionId",
          "artifactVersionId",
          "sourceAnchorId",
          "selector",
          "contentDigest"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "code": {
            "enum": [
              "snapshot_mismatch",
              "provenance_mismatch",
              "access_restricted",
              "unsupported_locator",
              "file_unavailable"
            ],
            "type": "string"
          },
          "message": {
            "maxLength": 4000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "code",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "evidence",
    "dag",
    "provenance"
  ],
  "title": "Resolve Evidence preview"
}
```

## `evidence-dag.update`

Queues one durable Evidence-only update for a completed agent thread.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `compute`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "operation": {
        "default": "update",
        "enum": [
          "update",
          "rebuild"
        ],
        "type": "string"
      },
      "rebuildKind": {
        "enum": [
          "schema_upgrade",
          "corruption_recovery",
          "reinterpretation"
        ],
        "type": "string"
      },
      "rebuildRationale": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string"
      },
      "runtimeId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "runtimeId",
      "threadId",
      "operation"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "coalesced": {
        "type": "boolean"
      },
      "itemCount": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "jobId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "status": {
        "additionalProperties": false,
        "properties": {
          "committed": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "artifactDigests": {
                    "items": {
                      "pattern": "^sha256:[0-9a-f]{64}$",
                      "type": "string"
                    },
                    "maxItems": 10000,
                    "type": "array"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "digest": {
                    "pattern": "^sha256:[0-9a-f]{64}$",
                    "type": "string"
                  },
                  "extractorVersion": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "inputWatermark": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "schemaVersion": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "threadId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "url": {
                    "format": "uri",
                    "maxLength": 4096,
                    "type": "string"
                  },
                  "verifierVersion": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "version": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  }
                },
                "required": [
                  "threadId",
                  "version",
                  "digest",
                  "inputWatermark",
                  "schemaVersion",
                  "extractorVersion",
                  "verifierVersion",
                  "artifactDigests",
                  "createdAt"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "pending": {
            "anyOf": [
              {
                "oneOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "state": {
                        "const": "queued",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "phase": {
                        "enum": [
                          "capturing",
                          "extracting",
                          "verifying",
                          "committing",
                          "handoff"
                        ],
                        "type": "string"
                      },
                      "state": {
                        "const": "running",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state",
                      "phase"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "error": {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "exclusiveMinimum": 0,
                            "maximum": 100,
                            "type": "integer"
                          },
                          "code": {
                            "enum": [
                              "model_output_incomplete",
                              "model_output_empty",
                              "model_output_invalid_json",
                              "upstream_timeout",
                              "upstream_rate_limited",
                              "upstream_unavailable",
                              "snapshot_corrupt",
                              "access_restricted",
                              "internal_error"
                            ],
                            "type": "string"
                          },
                          "incompleteReason": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "maxOutputTokens": {
                            "exclusiveMinimum": 0,
                            "maximum": 1000000,
                            "type": "integer"
                          },
                          "message": {
                            "maxLength": 4000,
                            "minLength": 1,
                            "type": "string"
                          },
                          "occurredAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "requestId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "responseStatus": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "retryable": {
                            "type": "boolean"
                          },
                          "upstreamStatus": {
                            "maximum": 599,
                            "minimum": 100,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "retryable",
                          "occurredAt"
                        ],
                        "type": "object"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "nextAttemptAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "state": {
                        "const": "retrying",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state",
                      "nextAttemptAt",
                      "error"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "error": {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "exclusiveMinimum": 0,
                            "maximum": 100,
                            "type": "integer"
                          },
                          "code": {
                            "enum": [
                              "model_output_incomplete",
                              "model_output_empty",
                              "model_output_invalid_json",
                              "upstream_timeout",
                              "upstream_rate_limited",
                              "upstream_unavailable",
                              "snapshot_corrupt",
                              "access_restricted",
                              "internal_error"
                            ],
                            "type": "string"
                          },
                          "incompleteReason": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "maxOutputTokens": {
                            "exclusiveMinimum": 0,
                            "maximum": 1000000,
                            "type": "integer"
                          },
                          "message": {
                            "maxLength": 4000,
                            "minLength": 1,
                            "type": "string"
                          },
                          "occurredAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "requestId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "responseStatus": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "retryable": {
                            "type": "boolean"
                          },
                          "upstreamStatus": {
                            "maximum": 599,
                            "minimum": 100,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "retryable",
                          "occurredAt"
                        ],
                        "type": "object"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "state": {
                        "const": "failed",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state",
                      "error"
                    ],
                    "type": "object"
                  }
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "committed",
          "pending",
          "updatedAt"
        ],
        "type": "object"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "url": {
        "format": "uri",
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "url",
      "threadId",
      "itemCount",
      "jobId",
      "coalesced",
      "status"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "evidence",
    "dag",
    "provenance"
  ],
  "title": "Update Evidence DAG"
}
```

## `evidence-dag.view`

Reads the last committed Evidence graph and its separate pending delta.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "runtimeId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "status": {
        "additionalProperties": false,
        "properties": {
          "committed": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "artifactDigests": {
                    "items": {
                      "pattern": "^sha256:[0-9a-f]{64}$",
                      "type": "string"
                    },
                    "maxItems": 10000,
                    "type": "array"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "digest": {
                    "pattern": "^sha256:[0-9a-f]{64}$",
                    "type": "string"
                  },
                  "extractorVersion": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "inputWatermark": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "schemaVersion": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "threadId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "url": {
                    "format": "uri",
                    "maxLength": 4096,
                    "type": "string"
                  },
                  "verifierVersion": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "version": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  }
                },
                "required": [
                  "threadId",
                  "version",
                  "digest",
                  "inputWatermark",
                  "schemaVersion",
                  "extractorVersion",
                  "verifierVersion",
                  "artifactDigests",
                  "createdAt"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "pending": {
            "anyOf": [
              {
                "oneOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "state": {
                        "const": "queued",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "phase": {
                        "enum": [
                          "capturing",
                          "extracting",
                          "verifying",
                          "committing",
                          "handoff"
                        ],
                        "type": "string"
                      },
                      "state": {
                        "const": "running",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state",
                      "phase"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "error": {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "exclusiveMinimum": 0,
                            "maximum": 100,
                            "type": "integer"
                          },
                          "code": {
                            "enum": [
                              "model_output_incomplete",
                              "model_output_empty",
                              "model_output_invalid_json",
                              "upstream_timeout",
                              "upstream_rate_limited",
                              "upstream_unavailable",
                              "snapshot_corrupt",
                              "access_restricted",
                              "internal_error"
                            ],
                            "type": "string"
                          },
                          "incompleteReason": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "maxOutputTokens": {
                            "exclusiveMinimum": 0,
                            "maximum": 1000000,
                            "type": "integer"
                          },
                          "message": {
                            "maxLength": 4000,
                            "minLength": 1,
                            "type": "string"
                          },
                          "occurredAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "requestId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "responseStatus": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "retryable": {
                            "type": "boolean"
                          },
                          "upstreamStatus": {
                            "maximum": 599,
                            "minimum": 100,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "retryable",
                          "occurredAt"
                        ],
                        "type": "object"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "nextAttemptAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "state": {
                        "const": "retrying",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state",
                      "nextAttemptAt",
                      "error"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "attempt": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "completedBatches": {
                        "maximum": 9007199254740991,
                        "minimum": 0,
                        "type": "integer"
                      },
                      "createdAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      },
                      "error": {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "exclusiveMinimum": 0,
                            "maximum": 100,
                            "type": "integer"
                          },
                          "code": {
                            "enum": [
                              "model_output_incomplete",
                              "model_output_empty",
                              "model_output_invalid_json",
                              "upstream_timeout",
                              "upstream_rate_limited",
                              "upstream_unavailable",
                              "snapshot_corrupt",
                              "access_restricted",
                              "internal_error"
                            ],
                            "type": "string"
                          },
                          "incompleteReason": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "maxOutputTokens": {
                            "exclusiveMinimum": 0,
                            "maximum": 1000000,
                            "type": "integer"
                          },
                          "message": {
                            "maxLength": 4000,
                            "minLength": 1,
                            "type": "string"
                          },
                          "occurredAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "requestId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "responseStatus": {
                            "maxLength": 256,
                            "minLength": 1,
                            "type": "string"
                          },
                          "retryable": {
                            "type": "boolean"
                          },
                          "upstreamStatus": {
                            "maximum": 599,
                            "minimum": 100,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "retryable",
                          "occurredAt"
                        ],
                        "type": "object"
                      },
                      "jobId": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "state": {
                        "const": "failed",
                        "type": "string"
                      },
                      "targetWatermark": {
                        "maxLength": 512,
                        "minLength": 1,
                        "type": "string"
                      },
                      "totalBatches": {
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991,
                        "type": "integer"
                      },
                      "updatedAt": {
                        "format": "date-time",
                        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "jobId",
                      "targetWatermark",
                      "attempt",
                      "createdAt",
                      "updatedAt",
                      "state",
                      "error"
                    ],
                    "type": "object"
                  }
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "committed",
          "pending",
          "updatedAt"
        ],
        "type": "object"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "url": {
        "format": "uri",
        "maxLength": 4096,
        "type": "string"
      }
    },
    "required": [
      "url",
      "status"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "evidence",
    "dag",
    "provenance"
  ],
  "title": "View Evidence DAG"
}
```

## `git-checkpoints.create`

Creates a manual checkpoint through the controlled version-control provider.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "phase": {
        "default": "manual",
        "enum": [
          "before-turn",
          "after-turn",
          "manual",
          "rescue"
        ],
        "type": "string"
      },
      "runtimeId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "turnId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "runtimeId",
      "threadId",
      "workspaceRoot",
      "phase"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "value": {
            "additionalProperties": false,
            "properties": {
              "changeSummary": {
                "maxLength": 100000,
                "type": "string"
              },
              "checkpointId": {
                "pattern": "^[A-Za-z0-9._-]{1,200}$",
                "type": "string"
              },
              "createdAt": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "phase": {
                "enum": [
                  "before-turn",
                  "after-turn",
                  "manual",
                  "rescue"
                ],
                "type": "string"
              },
              "provider": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "rescueCheckpointId": {
                "pattern": "^[A-Za-z0-9._-]{1,200}$",
                "type": "string"
              },
              "restoreStatus": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "revision": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "runtimeId": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "status": {
                "enum": [
                  "available",
                  "restored",
                  "blocked",
                  "failed"
                ],
                "type": "string"
              },
              "threadId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "turnId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "workspaceRoot": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "checkpointId",
              "runtimeId",
              "threadId",
              "phase",
              "workspaceRoot",
              "provider",
              "revision",
              "createdAt",
              "changeSummary",
              "status"
            ],
            "type": "object"
          }
        },
        "required": [
          "ok",
          "value"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "details": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema0"
              }
            ]
          },
          "message": {
            "maxLength": 4000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "reason": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "ok",
          "reason",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "git",
    "version-control",
    "checkpoint"
  ],
  "title": "Create Git checkpoint"
}
```

## `git-checkpoints.list`

Lists package-owned checkpoints in the caller workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "runtimeId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "value": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "changeSummary": {
                  "maxLength": 100000,
                  "type": "string"
                },
                "checkpointId": {
                  "pattern": "^[A-Za-z0-9._-]{1,200}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "phase": {
                  "enum": [
                    "before-turn",
                    "after-turn",
                    "manual",
                    "rescue"
                  ],
                  "type": "string"
                },
                "provider": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "rescueCheckpointId": {
                  "pattern": "^[A-Za-z0-9._-]{1,200}$",
                  "type": "string"
                },
                "restoreStatus": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "revision": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "runtimeId": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "available",
                    "restored",
                    "blocked",
                    "failed"
                  ],
                  "type": "string"
                },
                "threadId": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "turnId": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "workspaceRoot": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "checkpointId",
                "runtimeId",
                "threadId",
                "phase",
                "workspaceRoot",
                "provider",
                "revision",
                "createdAt",
                "changeSummary",
                "status"
              ],
              "type": "object"
            },
            "maxItems": 20000,
            "type": "array"
          }
        },
        "required": [
          "ok",
          "value"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "details": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema0"
              }
            ]
          },
          "message": {
            "maxLength": 4000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "reason": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "ok",
          "reason",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "git",
    "version-control",
    "checkpoint"
  ],
  "title": "List Git checkpoints"
}
```

## `git-checkpoints.preview`

Previews restoring one checkpoint without changing the workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkpointId": {
        "pattern": "^[A-Za-z0-9._-]{1,200}$",
        "type": "string"
      }
    },
    "required": [
      "checkpointId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "value": {
            "additionalProperties": false,
            "properties": {
              "checkpoint": {
                "additionalProperties": false,
                "properties": {
                  "changeSummary": {
                    "maxLength": 100000,
                    "type": "string"
                  },
                  "checkpointId": {
                    "pattern": "^[A-Za-z0-9._-]{1,200}$",
                    "type": "string"
                  },
                  "createdAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "phase": {
                    "enum": [
                      "before-turn",
                      "after-turn",
                      "manual",
                      "rescue"
                    ],
                    "type": "string"
                  },
                  "provider": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  },
                  "rescueCheckpointId": {
                    "pattern": "^[A-Za-z0-9._-]{1,200}$",
                    "type": "string"
                  },
                  "restoreStatus": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "revision": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "runtimeId": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  },
                  "status": {
                    "enum": [
                      "available",
                      "restored",
                      "blocked",
                      "failed"
                    ],
                    "type": "string"
                  },
                  "threadId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "turnId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "workspaceRoot": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "checkpointId",
                  "runtimeId",
                  "threadId",
                  "phase",
                  "workspaceRoot",
                  "provider",
                  "revision",
                  "createdAt",
                  "changeSummary",
                  "status"
                ],
                "type": "object"
              },
              "patch": {
                "maxLength": 1000000,
                "type": "string"
              },
              "truncated": {
                "type": "boolean"
              }
            },
            "required": [
              "checkpoint",
              "patch",
              "truncated"
            ],
            "type": "object"
          }
        },
        "required": [
          "ok",
          "value"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "details": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema0"
              }
            ]
          },
          "message": {
            "maxLength": 4000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "reason": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "ok",
          "reason",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "git",
    "version-control",
    "checkpoint"
  ],
  "title": "Preview Git checkpoint"
}
```

## `git-checkpoints.restore`

Captures a rescue checkpoint, then restores the selected checkpoint.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `destructive`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkpointId": {
        "pattern": "^[A-Za-z0-9._-]{1,200}$",
        "type": "string"
      }
    },
    "required": [
      "checkpointId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "value": {
            "additionalProperties": false,
            "properties": {
              "changeSummary": {
                "maxLength": 100000,
                "type": "string"
              },
              "checkpointId": {
                "pattern": "^[A-Za-z0-9._-]{1,200}$",
                "type": "string"
              },
              "createdAt": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "phase": {
                "enum": [
                  "before-turn",
                  "after-turn",
                  "manual",
                  "rescue"
                ],
                "type": "string"
              },
              "provider": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "rescueCheckpointId": {
                "pattern": "^[A-Za-z0-9._-]{1,200}$",
                "type": "string"
              },
              "restoreStatus": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "revision": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "runtimeId": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "status": {
                "enum": [
                  "available",
                  "restored",
                  "blocked",
                  "failed"
                ],
                "type": "string"
              },
              "threadId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "turnId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "workspaceRoot": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "checkpointId",
              "runtimeId",
              "threadId",
              "phase",
              "workspaceRoot",
              "provider",
              "revision",
              "createdAt",
              "changeSummary",
              "status",
              "rescueCheckpointId"
            ],
            "type": "object"
          }
        },
        "required": [
          "ok",
          "value"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "details": {
            "allOf": [
              {
                "$ref": "#/definitions/__schema0"
              }
            ]
          },
          "message": {
            "maxLength": 4000,
            "minLength": 1,
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "reason": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "ok",
          "reason",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "git",
    "version-control",
    "checkpoint"
  ],
  "title": "Restore Git checkpoint"
}
```

## `paper-radar.digest`

Generates a digest from the local Paper Radar index for a profile or keyword set.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "categories": {
        "items": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "days": {
        "exclusiveMinimum": 0,
        "maximum": 365,
        "type": "integer"
      },
      "excludeKeywords": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "from": {
        "maxLength": 64,
        "type": "string"
      },
      "keywords": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "profile": {
        "maxLength": 128,
        "type": "string"
      },
      "query": {
        "maxLength": 1000,
        "type": "string"
      },
      "sources": {
        "items": {
          "enum": [
            "arxiv",
            "biorxiv"
          ],
          "type": "string"
        },
        "maxItems": 2,
        "type": "array"
      },
      "to": {
        "maxLength": 64,
        "type": "string"
      },
      "topK": {
        "exclusiveMinimum": 0,
        "maximum": 100,
        "type": "integer"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "count": {
                "type": "number"
              },
              "generatedAt": {
                "type": "string"
              },
              "papers": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "absUrl": {
                      "type": "string"
                    },
                    "abstract": {
                      "type": "string"
                    },
                    "authors": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "categories": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "doi": {
                      "type": "string"
                    },
                    "externalId": {
                      "type": "string"
                    },
                    "id": {
                      "type": "string"
                    },
                    "pdfUrl": {
                      "type": "string"
                    },
                    "publishedAt": {
                      "type": "string"
                    },
                    "reason": {
                      "type": "string"
                    },
                    "relevance": {
                      "enum": [
                        "high",
                        "medium",
                        "low"
                      ],
                      "type": "string"
                    },
                    "score": {
                      "type": "number"
                    },
                    "source": {
                      "enum": [
                        "arxiv",
                        "biorxiv"
                      ],
                      "type": "string"
                    },
                    "subjects": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "title": {
                      "type": "string"
                    },
                    "updatedAt": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "source",
                    "externalId",
                    "title",
                    "authors",
                    "abstract",
                    "categories",
                    "subjects",
                    "publishedAt",
                    "absUrl"
                  ],
                  "type": "object"
                },
                "type": "array"
              },
              "profile": {
                "type": "string"
              }
            },
            "required": [
              "profile",
              "count",
              "papers",
              "generatedAt"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "digest"
  ],
  "title": "Generate a Paper Radar digest"
}
```

## `paper-radar.profiles.list`

Lists the locally configured Paper Radar profiles.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "profiles": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "arxivCategories": {
                      "items": {
                        "maxLength": 64,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxItems": 50,
                      "type": "array"
                    },
                    "biorxivSubjects": {
                      "items": {
                        "maxLength": 128,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxItems": 50,
                      "type": "array"
                    },
                    "description": {
                      "maxLength": 500,
                      "type": "string"
                    },
                    "excludeKeywords": {
                      "items": {
                        "maxLength": 128,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxItems": 100,
                      "type": "array"
                    },
                    "keywords": {
                      "items": {
                        "maxLength": 128,
                        "minLength": 1,
                        "type": "string"
                      },
                      "maxItems": 100,
                      "type": "array"
                    },
                    "name": {
                      "maxLength": 80,
                      "minLength": 1,
                      "type": "string"
                    }
                  },
                  "required": [
                    "name",
                    "keywords",
                    "excludeKeywords",
                    "arxivCategories",
                    "biorxivSubjects"
                  ],
                  "type": "object"
                },
                "type": "array"
              }
            },
            "required": [
              "profiles"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "profile",
    "discovery"
  ],
  "title": "List Paper Radar profiles"
}
```

## `paper-radar.profiles.save`

Creates or updates one local Paper Radar profile.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "arxivCategories": {
        "items": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "biorxivSubjects": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "description": {
        "maxLength": 500,
        "type": "string"
      },
      "excludeKeywords": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 100,
        "type": "array"
      },
      "keywords": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 100,
        "type": "array"
      },
      "name": {
        "maxLength": 80,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "name",
      "keywords",
      "excludeKeywords",
      "arxivCategories",
      "biorxivSubjects"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "profile": {
                "additionalProperties": false,
                "properties": {
                  "arxivCategories": {
                    "items": {
                      "maxLength": 64,
                      "minLength": 1,
                      "type": "string"
                    },
                    "maxItems": 50,
                    "type": "array"
                  },
                  "biorxivSubjects": {
                    "items": {
                      "maxLength": 128,
                      "minLength": 1,
                      "type": "string"
                    },
                    "maxItems": 50,
                    "type": "array"
                  },
                  "description": {
                    "maxLength": 500,
                    "type": "string"
                  },
                  "excludeKeywords": {
                    "items": {
                      "maxLength": 128,
                      "minLength": 1,
                      "type": "string"
                    },
                    "maxItems": 100,
                    "type": "array"
                  },
                  "keywords": {
                    "items": {
                      "maxLength": 128,
                      "minLength": 1,
                      "type": "string"
                    },
                    "maxItems": 100,
                    "type": "array"
                  },
                  "name": {
                    "maxLength": 80,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "name",
                  "keywords",
                  "excludeKeywords",
                  "arxivCategories",
                  "biorxivSubjects"
                ],
                "type": "object"
              }
            },
            "required": [
              "profile"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "profile"
  ],
  "title": "Save a Paper Radar profile"
}
```

## `paper-radar.rank`

Ranks papers from the local Paper Radar index for a profile or keyword set.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "categories": {
        "items": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "days": {
        "exclusiveMinimum": 0,
        "maximum": 365,
        "type": "integer"
      },
      "excludeKeywords": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "from": {
        "maxLength": 64,
        "type": "string"
      },
      "keywords": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "profile": {
        "maxLength": 128,
        "type": "string"
      },
      "query": {
        "maxLength": 1000,
        "type": "string"
      },
      "sources": {
        "items": {
          "enum": [
            "arxiv",
            "biorxiv"
          ],
          "type": "string"
        },
        "maxItems": 2,
        "type": "array"
      },
      "to": {
        "maxLength": 64,
        "type": "string"
      },
      "topK": {
        "exclusiveMinimum": 0,
        "maximum": 100,
        "type": "integer"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "count": {
                "type": "number"
              },
              "papers": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "absUrl": {
                      "type": "string"
                    },
                    "abstract": {
                      "type": "string"
                    },
                    "authors": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "categories": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "doi": {
                      "type": "string"
                    },
                    "externalId": {
                      "type": "string"
                    },
                    "id": {
                      "type": "string"
                    },
                    "pdfUrl": {
                      "type": "string"
                    },
                    "publishedAt": {
                      "type": "string"
                    },
                    "reason": {
                      "type": "string"
                    },
                    "relevance": {
                      "enum": [
                        "high",
                        "medium",
                        "low"
                      ],
                      "type": "string"
                    },
                    "score": {
                      "type": "number"
                    },
                    "source": {
                      "enum": [
                        "arxiv",
                        "biorxiv"
                      ],
                      "type": "string"
                    },
                    "subjects": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "title": {
                      "type": "string"
                    },
                    "updatedAt": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "source",
                    "externalId",
                    "title",
                    "authors",
                    "abstract",
                    "categories",
                    "subjects",
                    "publishedAt",
                    "absUrl"
                  ],
                  "type": "object"
                },
                "type": "array"
              },
              "profile": {
                "type": "string"
              }
            },
            "required": [
              "profile",
              "count",
              "papers"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "rank"
  ],
  "title": "Rank Paper Radar papers"
}
```

## `paper-radar.review`

Synchronizes and generates a Paper Radar review for one profile.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "days": {
        "exclusiveMinimum": 0,
        "maximum": 365,
        "type": "integer"
      },
      "maxRecords": {
        "exclusiveMinimum": 0,
        "maximum": 2000,
        "type": "integer"
      },
      "profile": {
        "additionalProperties": false,
        "properties": {
          "arxivCategories": {
            "items": {
              "maxLength": 64,
              "minLength": 1,
              "type": "string"
            },
            "maxItems": 50,
            "type": "array"
          },
          "biorxivSubjects": {
            "items": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "maxItems": 50,
            "type": "array"
          },
          "description": {
            "maxLength": 500,
            "type": "string"
          },
          "excludeKeywords": {
            "items": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "maxItems": 100,
            "type": "array"
          },
          "keywords": {
            "items": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "maxItems": 100,
            "type": "array"
          },
          "name": {
            "maxLength": 80,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "name",
          "keywords",
          "excludeKeywords",
          "arxivCategories",
          "biorxivSubjects"
        ],
        "type": "object"
      },
      "topK": {
        "exclusiveMinimum": 0,
        "maximum": 100,
        "type": "integer"
      }
    },
    "required": [
      "profile"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "count": {
                "type": "number"
              },
              "generatedAt": {
                "type": "string"
              },
              "papers": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "absUrl": {
                      "type": "string"
                    },
                    "abstract": {
                      "type": "string"
                    },
                    "authors": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "categories": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "doi": {
                      "type": "string"
                    },
                    "externalId": {
                      "type": "string"
                    },
                    "id": {
                      "type": "string"
                    },
                    "pdfUrl": {
                      "type": "string"
                    },
                    "publishedAt": {
                      "type": "string"
                    },
                    "reason": {
                      "type": "string"
                    },
                    "relevance": {
                      "enum": [
                        "high",
                        "medium",
                        "low"
                      ],
                      "type": "string"
                    },
                    "score": {
                      "type": "number"
                    },
                    "source": {
                      "enum": [
                        "arxiv",
                        "biorxiv"
                      ],
                      "type": "string"
                    },
                    "subjects": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "title": {
                      "type": "string"
                    },
                    "updatedAt": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "source",
                    "externalId",
                    "title",
                    "authors",
                    "abstract",
                    "categories",
                    "subjects",
                    "publishedAt",
                    "absUrl"
                  ],
                  "type": "object"
                },
                "type": "array"
              },
              "profile": {
                "type": "string"
              },
              "syncResults": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "fetched": {
                      "type": "number"
                    },
                    "from": {
                      "type": "string"
                    },
                    "skipped": {
                      "type": "number"
                    },
                    "source": {
                      "enum": [
                        "arxiv",
                        "biorxiv"
                      ],
                      "type": "string"
                    },
                    "to": {
                      "type": "string"
                    },
                    "upserted": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "source",
                    "fetched",
                    "upserted",
                    "skipped"
                  ],
                  "type": "object"
                },
                "type": "array"
              }
            },
            "required": [
              "profile",
              "count",
              "papers",
              "generatedAt",
              "syncResults"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "review"
  ],
  "title": "Review papers for a profile"
}
```

## `paper-radar.search`

Searches the local Paper Radar index with bounded filters.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "categories": {
        "items": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "from": {
        "maxLength": 64,
        "type": "string"
      },
      "query": {
        "maxLength": 1000,
        "type": "string"
      },
      "sources": {
        "items": {
          "enum": [
            "arxiv",
            "biorxiv"
          ],
          "type": "string"
        },
        "maxItems": 2,
        "type": "array"
      },
      "to": {
        "maxLength": 64,
        "type": "string"
      },
      "topK": {
        "exclusiveMinimum": 0,
        "maximum": 100,
        "type": "integer"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "count": {
                "type": "number"
              },
              "papers": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "absUrl": {
                      "type": "string"
                    },
                    "abstract": {
                      "type": "string"
                    },
                    "authors": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "categories": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "doi": {
                      "type": "string"
                    },
                    "externalId": {
                      "type": "string"
                    },
                    "id": {
                      "type": "string"
                    },
                    "pdfUrl": {
                      "type": "string"
                    },
                    "publishedAt": {
                      "type": "string"
                    },
                    "reason": {
                      "type": "string"
                    },
                    "relevance": {
                      "enum": [
                        "high",
                        "medium",
                        "low"
                      ],
                      "type": "string"
                    },
                    "score": {
                      "type": "number"
                    },
                    "source": {
                      "enum": [
                        "arxiv",
                        "biorxiv"
                      ],
                      "type": "string"
                    },
                    "subjects": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "title": {
                      "type": "string"
                    },
                    "updatedAt": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "source",
                    "externalId",
                    "title",
                    "authors",
                    "abstract",
                    "categories",
                    "subjects",
                    "publishedAt",
                    "absUrl"
                  ],
                  "type": "object"
                },
                "type": "array"
              }
            },
            "required": [
              "papers",
              "count"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "search"
  ],
  "title": "Search Paper Radar papers"
}
```

## `paper-radar.status`

Returns the current status and local index statistics for Paper Radar.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkedAt": {
        "type": "string"
      },
      "message": {
        "type": "string"
      },
      "ok": {
        "type": "boolean"
      },
      "service": {
        "type": "string"
      },
      "stats": {
        "additionalProperties": false,
        "properties": {
          "arxiv": {
            "type": "number"
          },
          "biorxiv": {
            "type": "number"
          },
          "papers": {
            "type": "number"
          }
        },
        "required": [
          "papers",
          "arxiv",
          "biorxiv"
        ],
        "type": "object"
      }
    },
    "required": [
      "ok"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "status"
  ],
  "title": "Read Paper Radar status"
}
```

## `paper-radar.sync-arxiv`

Synchronizes a bounded arXiv paper set into the local Paper Radar index.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "categories": {
        "items": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "type": "array"
      },
      "maxRecords": {
        "exclusiveMinimum": 0,
        "maximum": 2000,
        "type": "integer"
      },
      "since": {
        "maxLength": 64,
        "type": "string"
      },
      "until": {
        "maxLength": 64,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "fetched": {
                "type": "number"
              },
              "from": {
                "type": "string"
              },
              "skipped": {
                "type": "number"
              },
              "source": {
                "enum": [
                  "arxiv",
                  "biorxiv"
                ],
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "upserted": {
                "type": "number"
              }
            },
            "required": [
              "source",
              "fetched",
              "upserted",
              "skipped"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "sync",
    "arxiv"
  ],
  "title": "Sync arXiv papers"
}
```

## `paper-radar.sync-biorxiv`

Synchronizes a bounded bioRxiv paper set into the local Paper Radar index.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "from": {
        "maxLength": 64,
        "type": "string"
      },
      "maxRecords": {
        "exclusiveMinimum": 0,
        "maximum": 2000,
        "type": "integer"
      },
      "to": {
        "maxLength": 64,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "fetched": {
                "type": "number"
              },
              "from": {
                "type": "string"
              },
              "skipped": {
                "type": "number"
              },
              "source": {
                "enum": [
                  "arxiv",
                  "biorxiv"
                ],
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "upserted": {
                "type": "number"
              }
            },
            "required": [
              "source",
              "fetched",
              "upserted",
              "skipped"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "sync",
    "biorxiv"
  ],
  "title": "Sync bioRxiv papers"
}
```

## `paper-radar.sync-profile`

Synchronizes papers matching one configured Paper Radar profile.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "from": {
        "maxLength": 64,
        "type": "string"
      },
      "maxRecords": {
        "exclusiveMinimum": 0,
        "maximum": 2000,
        "type": "integer"
      },
      "profile": {
        "maxLength": 128,
        "type": "string"
      },
      "to": {
        "maxLength": 64,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "profile": {
                "type": "string"
              },
              "results": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "fetched": {
                      "type": "number"
                    },
                    "from": {
                      "type": "string"
                    },
                    "skipped": {
                      "type": "number"
                    },
                    "source": {
                      "enum": [
                        "arxiv",
                        "biorxiv"
                      ],
                      "type": "string"
                    },
                    "to": {
                      "type": "string"
                    },
                    "upserted": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "source",
                    "fetched",
                    "upserted",
                    "skipped"
                  ],
                  "type": "object"
                },
                "type": "array"
              }
            },
            "required": [
              "profile",
              "results"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "message": {
            "type": "string"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "message"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "paper-radar",
    "sync",
    "profile"
  ],
  "title": "Sync a Paper Radar profile"
}
```

## `project-dag.evidence-preview.resolve`

Resolves one provenance-verified Project Claim evidence file.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "artifactVersionId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "claimId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "project": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "projectRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      },
      "sessions": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 500,
        "type": "array"
      },
      "snapshotDigest": {
        "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
        "type": "string"
      },
      "sourceAnchorId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workspaceRoot",
      "snapshotDigest",
      "claimId",
      "artifactVersionId",
      "sourceAnchorId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "anchorDigest": {
                "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                "type": "string"
              },
              "artifactId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "artifactVersionId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "claimId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "contentDigest": {
                "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                "type": "string"
              },
              "mediaType": {
                "maxLength": 500,
                "minLength": 1,
                "type": "string"
              },
              "path": {
                "maxLength": 16384,
                "minLength": 1,
                "type": "string"
              },
              "selector": {
                "additionalProperties": false,
                "properties": {
                  "columnNames": {
                    "items": {
                      "maxLength": 500,
                      "minLength": 1,
                      "type": "string"
                    },
                    "maxItems": 500,
                    "type": "array"
                  },
                  "figure": {
                    "maxLength": 1000,
                    "type": "string"
                  },
                  "lineRange": {
                    "maxLength": 1000,
                    "type": "string"
                  },
                  "page": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "query": {
                    "additionalProperties": {},
                    "propertyNames": {
                      "maxLength": 500,
                      "type": "string"
                    },
                    "type": "object"
                  },
                  "quote": {
                    "maxLength": 20000,
                    "type": "string"
                  },
                  "rowRange": {
                    "maxLength": 1000,
                    "type": "string"
                  },
                  "section": {
                    "maxLength": 1000,
                    "type": "string"
                  },
                  "table": {
                    "maxLength": 1000,
                    "type": "string"
                  },
                  "type": {
                    "enum": [
                      "pdf",
                      "text",
                      "table",
                      "figure",
                      "code",
                      "dataset",
                      "web"
                    ],
                    "type": "string"
                  }
                },
                "required": [
                  "type"
                ],
                "type": "object"
              },
              "snapshotDigest": {
                "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                "type": "string"
              },
              "sourceAnchorId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "workspaceRoot": {
                "maxLength": 16384,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "path",
              "workspaceRoot",
              "snapshotDigest",
              "claimId",
              "artifactVersionId",
              "sourceAnchorId",
              "selector"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "error": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "invalid_request",
                  "project_not_found",
                  "receipt_not_found",
                  "receipt_fingerprint_mismatch",
                  "evidence_vector_regression",
                  "evidence_snapshot_unavailable",
                  "project_compile_failed",
                  "snapshot_mismatch",
                  "claim_mismatch",
                  "provenance_mismatch",
                  "access_restricted",
                  "unsupported_locator",
                  "file_unavailable",
                  "upstream_timeout",
                  "upstream_unavailable",
                  "internal_error"
                ],
                "type": "string"
              },
              "details": {
                "additionalProperties": {
                  "anyOf": [
                    {
                      "maxLength": 4000,
                      "type": "string"
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "boolean"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "propertyNames": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "type": "object"
              },
              "message": {
                "maxLength": 4000,
                "minLength": 1,
                "type": "string"
              },
              "retryable": {
                "type": "boolean"
              }
            },
            "required": [
              "code",
              "message",
              "retryable"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "error"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "project-dag",
    "evidence",
    "preview"
  ],
  "title": "Resolve Project DAG evidence preview"
}
```

## `project-dag.goal.save`

Creates or updates the Project research goal and schedules canonical recompilation.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `compute`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "autonomyMode": {
        "enum": [
          "autonomous",
          "checkpointed",
          "supervised"
        ],
        "type": "string"
      },
      "description": {
        "maxLength": 4000,
        "type": "string"
      },
      "project": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "projectRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      },
      "rootGoalId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "sessions": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 500,
        "type": "array"
      },
      "title": {
        "maxLength": 500,
        "minLength": 1,
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "title"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "goal": {
                "additionalProperties": false,
                "properties": {
                  "description": {
                    "maxLength": 4000,
                    "type": "string"
                  },
                  "id": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 500,
                    "minLength": 1,
                    "type": "string"
                  },
                  "version": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  }
                },
                "required": [
                  "id",
                  "title",
                  "version"
                ],
                "type": "object"
              },
              "status": {
                "additionalProperties": false,
                "properties": {
                  "attentionCount": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "auditStale": {
                    "type": "boolean"
                  },
                  "auditTargetDigest": {
                    "anyOf": [
                      {
                        "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "autonomyMode": {
                    "enum": [
                      "autonomous",
                      "checkpointed",
                      "supervised"
                    ],
                    "type": "string"
                  },
                  "committed": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "createdAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "digest": {
                            "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                            "type": "string"
                          },
                          "evidenceVector": {
                            "items": {
                              "additionalProperties": false,
                              "properties": {
                                "digest": {
                                  "pattern": "^sha256:[0-9a-f]{64}$",
                                  "type": "string"
                                },
                                "threadId": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                }
                              },
                              "required": [
                                "threadId",
                                "digest"
                              ],
                              "type": "object"
                            },
                            "maxItems": 500,
                            "type": "array"
                          },
                          "version": {
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "version",
                          "digest",
                          "evidenceVector",
                          "createdAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "latestReceipt": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "acceptedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "acceptedRequestVersion": {
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991,
                            "type": "integer"
                          },
                          "capturedScope": {
                            "additionalProperties": false,
                            "properties": {
                              "excludedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "includedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "isolatedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              }
                            },
                            "required": [
                              "includedSessions",
                              "excludedSessions",
                              "isolatedSessions"
                            ],
                            "type": "object"
                          },
                          "desiredEvidenceVector": {
                            "items": {
                              "additionalProperties": false,
                              "properties": {
                                "digest": {
                                  "pattern": "^sha256:[0-9a-f]{64}$",
                                  "type": "string"
                                },
                                "threadId": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                }
                              },
                              "required": [
                                "threadId",
                                "digest"
                              ],
                              "type": "object"
                            },
                            "maxItems": 500,
                            "type": "array"
                          },
                          "desiredFingerprint": {
                            "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                            "type": "string"
                          },
                          "jobId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "projectKey": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "state": {
                            "enum": [
                              "queued",
                              "running",
                              "committed",
                              "covered",
                              "superseded",
                              "failed"
                            ],
                            "type": "string"
                          },
                          "updatedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "projectKey",
                          "jobId",
                          "acceptedRequestVersion",
                          "desiredFingerprint",
                          "desiredEvidenceVector",
                          "capturedScope",
                          "state",
                          "acceptedAt",
                          "updatedAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "pending": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "maximum": 9007199254740991,
                            "minimum": 0,
                            "type": "integer"
                          },
                          "error": {
                            "anyOf": [
                              {
                                "additionalProperties": false,
                                "properties": {
                                  "code": {
                                    "enum": [
                                      "invalid_request",
                                      "project_not_found",
                                      "receipt_not_found",
                                      "receipt_fingerprint_mismatch",
                                      "evidence_vector_regression",
                                      "evidence_snapshot_unavailable",
                                      "project_compile_failed",
                                      "snapshot_mismatch",
                                      "claim_mismatch",
                                      "provenance_mismatch",
                                      "access_restricted",
                                      "unsupported_locator",
                                      "file_unavailable",
                                      "upstream_timeout",
                                      "upstream_unavailable",
                                      "internal_error"
                                    ],
                                    "type": "string"
                                  },
                                  "details": {
                                    "additionalProperties": {
                                      "anyOf": [
                                        {
                                          "maxLength": 4000,
                                          "type": "string"
                                        },
                                        {
                                          "type": "number"
                                        },
                                        {
                                          "type": "boolean"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    },
                                    "propertyNames": {
                                      "maxLength": 128,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "type": "object"
                                  },
                                  "message": {
                                    "maxLength": 4000,
                                    "minLength": 1,
                                    "type": "string"
                                  },
                                  "retryable": {
                                    "type": "boolean"
                                  }
                                },
                                "required": [
                                  "code",
                                  "message",
                                  "retryable"
                                ],
                                "type": "object"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "nextAttemptAt": {
                            "anyOf": [
                              {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "receipt": {
                            "additionalProperties": false,
                            "properties": {
                              "acceptedAt": {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              },
                              "acceptedRequestVersion": {
                                "exclusiveMinimum": 0,
                                "maximum": 9007199254740991,
                                "type": "integer"
                              },
                              "capturedScope": {
                                "additionalProperties": false,
                                "properties": {
                                  "excludedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  },
                                  "includedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  },
                                  "isolatedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  }
                                },
                                "required": [
                                  "includedSessions",
                                  "excludedSessions",
                                  "isolatedSessions"
                                ],
                                "type": "object"
                              },
                              "desiredEvidenceVector": {
                                "items": {
                                  "additionalProperties": false,
                                  "properties": {
                                    "digest": {
                                      "pattern": "^sha256:[0-9a-f]{64}$",
                                      "type": "string"
                                    },
                                    "threadId": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    }
                                  },
                                  "required": [
                                    "threadId",
                                    "digest"
                                  ],
                                  "type": "object"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "desiredFingerprint": {
                                "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                                "type": "string"
                              },
                              "jobId": {
                                "maxLength": 512,
                                "minLength": 1,
                                "type": "string"
                              },
                              "projectKey": {
                                "maxLength": 512,
                                "minLength": 1,
                                "type": "string"
                              },
                              "state": {
                                "enum": [
                                  "queued",
                                  "running",
                                  "committed",
                                  "covered",
                                  "superseded",
                                  "failed"
                                ],
                                "type": "string"
                              },
                              "updatedAt": {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              }
                            },
                            "required": [
                              "projectKey",
                              "jobId",
                              "acceptedRequestVersion",
                              "desiredFingerprint",
                              "desiredEvidenceVector",
                              "capturedScope",
                              "state",
                              "acceptedAt",
                              "updatedAt"
                            ],
                            "type": "object"
                          },
                          "state": {
                            "enum": [
                              "queued",
                              "running",
                              "retry_scheduled",
                              "failed"
                            ],
                            "type": "string"
                          },
                          "updatedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "state",
                          "receipt",
                          "attempts",
                          "updatedAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "projectKey": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "scope": {
                    "additionalProperties": false,
                    "properties": {
                      "excludedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "includedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "isolatedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      }
                    },
                    "required": [
                      "includedSessions",
                      "excludedSessions",
                      "isolatedSessions"
                    ],
                    "type": "object"
                  }
                },
                "required": [
                  "projectKey",
                  "committed",
                  "pending",
                  "scope",
                  "autonomyMode",
                  "attentionCount"
                ],
                "type": "object"
              }
            },
            "required": [
              "goal",
              "status"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "error": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "invalid_request",
                  "project_not_found",
                  "receipt_not_found",
                  "receipt_fingerprint_mismatch",
                  "evidence_vector_regression",
                  "evidence_snapshot_unavailable",
                  "project_compile_failed",
                  "snapshot_mismatch",
                  "claim_mismatch",
                  "provenance_mismatch",
                  "access_restricted",
                  "unsupported_locator",
                  "file_unavailable",
                  "upstream_timeout",
                  "upstream_unavailable",
                  "internal_error"
                ],
                "type": "string"
              },
              "details": {
                "additionalProperties": {
                  "anyOf": [
                    {
                      "maxLength": 4000,
                      "type": "string"
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "boolean"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "propertyNames": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "type": "object"
              },
              "message": {
                "maxLength": 4000,
                "minLength": 1,
                "type": "string"
              },
              "retryable": {
                "type": "boolean"
              }
            },
            "required": [
              "code",
              "message",
              "retryable"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "error"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "project-dag",
    "goal"
  ],
  "title": "Save Project DAG goal"
}
```

## `project-dag.update`

Submits one idempotent durable Project update from committed Evidence snapshots.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `compute`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "autonomyMode": {
        "enum": [
          "autonomous",
          "checkpointed",
          "supervised"
        ],
        "type": "string"
      },
      "excludedSessions": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 500,
        "type": "array"
      },
      "isolatedSessions": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 500,
        "type": "array"
      },
      "project": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "projectRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      },
      "scope": {
        "anyOf": [
          {
            "const": "all",
            "type": "string"
          },
          {
            "items": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            },
            "maxItems": 500,
            "type": "array"
          }
        ]
      },
      "sessions": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 500,
        "type": "array"
      },
      "workspaceRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "receipt": {
                "additionalProperties": false,
                "properties": {
                  "acceptedAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  },
                  "acceptedRequestVersion": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "capturedScope": {
                    "additionalProperties": false,
                    "properties": {
                      "excludedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "includedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "isolatedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      }
                    },
                    "required": [
                      "includedSessions",
                      "excludedSessions",
                      "isolatedSessions"
                    ],
                    "type": "object"
                  },
                  "desiredEvidenceVector": {
                    "items": {
                      "additionalProperties": false,
                      "properties": {
                        "digest": {
                          "pattern": "^sha256:[0-9a-f]{64}$",
                          "type": "string"
                        },
                        "threadId": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        }
                      },
                      "required": [
                        "threadId",
                        "digest"
                      ],
                      "type": "object"
                    },
                    "maxItems": 500,
                    "type": "array"
                  },
                  "desiredFingerprint": {
                    "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                    "type": "string"
                  },
                  "jobId": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "projectKey": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "state": {
                    "enum": [
                      "queued",
                      "running",
                      "committed",
                      "covered",
                      "superseded",
                      "failed"
                    ],
                    "type": "string"
                  },
                  "updatedAt": {
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                    "type": "string"
                  }
                },
                "required": [
                  "projectKey",
                  "jobId",
                  "acceptedRequestVersion",
                  "desiredFingerprint",
                  "desiredEvidenceVector",
                  "capturedScope",
                  "state",
                  "acceptedAt",
                  "updatedAt"
                ],
                "type": "object"
              },
              "status": {
                "additionalProperties": false,
                "properties": {
                  "attentionCount": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "auditStale": {
                    "type": "boolean"
                  },
                  "auditTargetDigest": {
                    "anyOf": [
                      {
                        "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "autonomyMode": {
                    "enum": [
                      "autonomous",
                      "checkpointed",
                      "supervised"
                    ],
                    "type": "string"
                  },
                  "committed": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "createdAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "digest": {
                            "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                            "type": "string"
                          },
                          "evidenceVector": {
                            "items": {
                              "additionalProperties": false,
                              "properties": {
                                "digest": {
                                  "pattern": "^sha256:[0-9a-f]{64}$",
                                  "type": "string"
                                },
                                "threadId": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                }
                              },
                              "required": [
                                "threadId",
                                "digest"
                              ],
                              "type": "object"
                            },
                            "maxItems": 500,
                            "type": "array"
                          },
                          "version": {
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "version",
                          "digest",
                          "evidenceVector",
                          "createdAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "latestReceipt": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "acceptedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "acceptedRequestVersion": {
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991,
                            "type": "integer"
                          },
                          "capturedScope": {
                            "additionalProperties": false,
                            "properties": {
                              "excludedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "includedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "isolatedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              }
                            },
                            "required": [
                              "includedSessions",
                              "excludedSessions",
                              "isolatedSessions"
                            ],
                            "type": "object"
                          },
                          "desiredEvidenceVector": {
                            "items": {
                              "additionalProperties": false,
                              "properties": {
                                "digest": {
                                  "pattern": "^sha256:[0-9a-f]{64}$",
                                  "type": "string"
                                },
                                "threadId": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                }
                              },
                              "required": [
                                "threadId",
                                "digest"
                              ],
                              "type": "object"
                            },
                            "maxItems": 500,
                            "type": "array"
                          },
                          "desiredFingerprint": {
                            "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                            "type": "string"
                          },
                          "jobId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "projectKey": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "state": {
                            "enum": [
                              "queued",
                              "running",
                              "committed",
                              "covered",
                              "superseded",
                              "failed"
                            ],
                            "type": "string"
                          },
                          "updatedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "projectKey",
                          "jobId",
                          "acceptedRequestVersion",
                          "desiredFingerprint",
                          "desiredEvidenceVector",
                          "capturedScope",
                          "state",
                          "acceptedAt",
                          "updatedAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "pending": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "maximum": 9007199254740991,
                            "minimum": 0,
                            "type": "integer"
                          },
                          "error": {
                            "anyOf": [
                              {
                                "additionalProperties": false,
                                "properties": {
                                  "code": {
                                    "enum": [
                                      "invalid_request",
                                      "project_not_found",
                                      "receipt_not_found",
                                      "receipt_fingerprint_mismatch",
                                      "evidence_vector_regression",
                                      "evidence_snapshot_unavailable",
                                      "project_compile_failed",
                                      "snapshot_mismatch",
                                      "claim_mismatch",
                                      "provenance_mismatch",
                                      "access_restricted",
                                      "unsupported_locator",
                                      "file_unavailable",
                                      "upstream_timeout",
                                      "upstream_unavailable",
                                      "internal_error"
                                    ],
                                    "type": "string"
                                  },
                                  "details": {
                                    "additionalProperties": {
                                      "anyOf": [
                                        {
                                          "maxLength": 4000,
                                          "type": "string"
                                        },
                                        {
                                          "type": "number"
                                        },
                                        {
                                          "type": "boolean"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    },
                                    "propertyNames": {
                                      "maxLength": 128,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "type": "object"
                                  },
                                  "message": {
                                    "maxLength": 4000,
                                    "minLength": 1,
                                    "type": "string"
                                  },
                                  "retryable": {
                                    "type": "boolean"
                                  }
                                },
                                "required": [
                                  "code",
                                  "message",
                                  "retryable"
                                ],
                                "type": "object"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "nextAttemptAt": {
                            "anyOf": [
                              {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "receipt": {
                            "additionalProperties": false,
                            "properties": {
                              "acceptedAt": {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              },
                              "acceptedRequestVersion": {
                                "exclusiveMinimum": 0,
                                "maximum": 9007199254740991,
                                "type": "integer"
                              },
                              "capturedScope": {
                                "additionalProperties": false,
                                "properties": {
                                  "excludedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  },
                                  "includedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  },
                                  "isolatedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  }
                                },
                                "required": [
                                  "includedSessions",
                                  "excludedSessions",
                                  "isolatedSessions"
                                ],
                                "type": "object"
                              },
                              "desiredEvidenceVector": {
                                "items": {
                                  "additionalProperties": false,
                                  "properties": {
                                    "digest": {
                                      "pattern": "^sha256:[0-9a-f]{64}$",
                                      "type": "string"
                                    },
                                    "threadId": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    }
                                  },
                                  "required": [
                                    "threadId",
                                    "digest"
                                  ],
                                  "type": "object"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "desiredFingerprint": {
                                "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                                "type": "string"
                              },
                              "jobId": {
                                "maxLength": 512,
                                "minLength": 1,
                                "type": "string"
                              },
                              "projectKey": {
                                "maxLength": 512,
                                "minLength": 1,
                                "type": "string"
                              },
                              "state": {
                                "enum": [
                                  "queued",
                                  "running",
                                  "committed",
                                  "covered",
                                  "superseded",
                                  "failed"
                                ],
                                "type": "string"
                              },
                              "updatedAt": {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              }
                            },
                            "required": [
                              "projectKey",
                              "jobId",
                              "acceptedRequestVersion",
                              "desiredFingerprint",
                              "desiredEvidenceVector",
                              "capturedScope",
                              "state",
                              "acceptedAt",
                              "updatedAt"
                            ],
                            "type": "object"
                          },
                          "state": {
                            "enum": [
                              "queued",
                              "running",
                              "retry_scheduled",
                              "failed"
                            ],
                            "type": "string"
                          },
                          "updatedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "state",
                          "receipt",
                          "attempts",
                          "updatedAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "projectKey": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "scope": {
                    "additionalProperties": false,
                    "properties": {
                      "excludedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "includedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "isolatedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      }
                    },
                    "required": [
                      "includedSessions",
                      "excludedSessions",
                      "isolatedSessions"
                    ],
                    "type": "object"
                  }
                },
                "required": [
                  "projectKey",
                  "committed",
                  "pending",
                  "scope",
                  "autonomyMode",
                  "attentionCount"
                ],
                "type": "object"
              },
              "url": {
                "maxLength": 8192,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "url",
              "receipt",
              "status"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "error": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "invalid_request",
                  "project_not_found",
                  "receipt_not_found",
                  "receipt_fingerprint_mismatch",
                  "evidence_vector_regression",
                  "evidence_snapshot_unavailable",
                  "project_compile_failed",
                  "snapshot_mismatch",
                  "claim_mismatch",
                  "provenance_mismatch",
                  "access_restricted",
                  "unsupported_locator",
                  "file_unavailable",
                  "upstream_timeout",
                  "upstream_unavailable",
                  "internal_error"
                ],
                "type": "string"
              },
              "details": {
                "additionalProperties": {
                  "anyOf": [
                    {
                      "maxLength": 4000,
                      "type": "string"
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "boolean"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "propertyNames": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "type": "object"
              },
              "message": {
                "maxLength": 4000,
                "minLength": 1,
                "type": "string"
              },
              "retryable": {
                "type": "boolean"
              }
            },
            "required": [
              "code",
              "message",
              "retryable"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "error"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "project-dag",
    "graph",
    "compile"
  ],
  "title": "Update Project DAG"
}
```

## `project-dag.view`

Reads the canonical committed Project graph and current update state.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "project": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "projectRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      },
      "sessions": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 500,
        "type": "array"
      },
      "view": {
        "enum": [
          "home",
          "goals",
          "graph",
          "attention"
        ],
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 16384,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "data": {
            "additionalProperties": false,
            "properties": {
              "goal": {
                "additionalProperties": false,
                "properties": {
                  "description": {
                    "maxLength": 4000,
                    "type": "string"
                  },
                  "id": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 500,
                    "minLength": 1,
                    "type": "string"
                  },
                  "version": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  }
                },
                "required": [
                  "id",
                  "title",
                  "version"
                ],
                "type": "object"
              },
              "status": {
                "additionalProperties": false,
                "properties": {
                  "attentionCount": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "auditStale": {
                    "type": "boolean"
                  },
                  "auditTargetDigest": {
                    "anyOf": [
                      {
                        "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "autonomyMode": {
                    "enum": [
                      "autonomous",
                      "checkpointed",
                      "supervised"
                    ],
                    "type": "string"
                  },
                  "committed": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "createdAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "digest": {
                            "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                            "type": "string"
                          },
                          "evidenceVector": {
                            "items": {
                              "additionalProperties": false,
                              "properties": {
                                "digest": {
                                  "pattern": "^sha256:[0-9a-f]{64}$",
                                  "type": "string"
                                },
                                "threadId": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                }
                              },
                              "required": [
                                "threadId",
                                "digest"
                              ],
                              "type": "object"
                            },
                            "maxItems": 500,
                            "type": "array"
                          },
                          "version": {
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "version",
                          "digest",
                          "evidenceVector",
                          "createdAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "latestReceipt": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "acceptedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          },
                          "acceptedRequestVersion": {
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991,
                            "type": "integer"
                          },
                          "capturedScope": {
                            "additionalProperties": false,
                            "properties": {
                              "excludedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "includedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "isolatedSessions": {
                                "items": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                },
                                "maxItems": 500,
                                "type": "array"
                              }
                            },
                            "required": [
                              "includedSessions",
                              "excludedSessions",
                              "isolatedSessions"
                            ],
                            "type": "object"
                          },
                          "desiredEvidenceVector": {
                            "items": {
                              "additionalProperties": false,
                              "properties": {
                                "digest": {
                                  "pattern": "^sha256:[0-9a-f]{64}$",
                                  "type": "string"
                                },
                                "threadId": {
                                  "maxLength": 512,
                                  "minLength": 1,
                                  "type": "string"
                                }
                              },
                              "required": [
                                "threadId",
                                "digest"
                              ],
                              "type": "object"
                            },
                            "maxItems": 500,
                            "type": "array"
                          },
                          "desiredFingerprint": {
                            "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                            "type": "string"
                          },
                          "jobId": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "projectKey": {
                            "maxLength": 512,
                            "minLength": 1,
                            "type": "string"
                          },
                          "state": {
                            "enum": [
                              "queued",
                              "running",
                              "committed",
                              "covered",
                              "superseded",
                              "failed"
                            ],
                            "type": "string"
                          },
                          "updatedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "projectKey",
                          "jobId",
                          "acceptedRequestVersion",
                          "desiredFingerprint",
                          "desiredEvidenceVector",
                          "capturedScope",
                          "state",
                          "acceptedAt",
                          "updatedAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "pending": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "attempts": {
                            "maximum": 9007199254740991,
                            "minimum": 0,
                            "type": "integer"
                          },
                          "error": {
                            "anyOf": [
                              {
                                "additionalProperties": false,
                                "properties": {
                                  "code": {
                                    "enum": [
                                      "invalid_request",
                                      "project_not_found",
                                      "receipt_not_found",
                                      "receipt_fingerprint_mismatch",
                                      "evidence_vector_regression",
                                      "evidence_snapshot_unavailable",
                                      "project_compile_failed",
                                      "snapshot_mismatch",
                                      "claim_mismatch",
                                      "provenance_mismatch",
                                      "access_restricted",
                                      "unsupported_locator",
                                      "file_unavailable",
                                      "upstream_timeout",
                                      "upstream_unavailable",
                                      "internal_error"
                                    ],
                                    "type": "string"
                                  },
                                  "details": {
                                    "additionalProperties": {
                                      "anyOf": [
                                        {
                                          "maxLength": 4000,
                                          "type": "string"
                                        },
                                        {
                                          "type": "number"
                                        },
                                        {
                                          "type": "boolean"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    },
                                    "propertyNames": {
                                      "maxLength": 128,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "type": "object"
                                  },
                                  "message": {
                                    "maxLength": 4000,
                                    "minLength": 1,
                                    "type": "string"
                                  },
                                  "retryable": {
                                    "type": "boolean"
                                  }
                                },
                                "required": [
                                  "code",
                                  "message",
                                  "retryable"
                                ],
                                "type": "object"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "nextAttemptAt": {
                            "anyOf": [
                              {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "receipt": {
                            "additionalProperties": false,
                            "properties": {
                              "acceptedAt": {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              },
                              "acceptedRequestVersion": {
                                "exclusiveMinimum": 0,
                                "maximum": 9007199254740991,
                                "type": "integer"
                              },
                              "capturedScope": {
                                "additionalProperties": false,
                                "properties": {
                                  "excludedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  },
                                  "includedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  },
                                  "isolatedSessions": {
                                    "items": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    },
                                    "maxItems": 500,
                                    "type": "array"
                                  }
                                },
                                "required": [
                                  "includedSessions",
                                  "excludedSessions",
                                  "isolatedSessions"
                                ],
                                "type": "object"
                              },
                              "desiredEvidenceVector": {
                                "items": {
                                  "additionalProperties": false,
                                  "properties": {
                                    "digest": {
                                      "pattern": "^sha256:[0-9a-f]{64}$",
                                      "type": "string"
                                    },
                                    "threadId": {
                                      "maxLength": 512,
                                      "minLength": 1,
                                      "type": "string"
                                    }
                                  },
                                  "required": [
                                    "threadId",
                                    "digest"
                                  ],
                                  "type": "object"
                                },
                                "maxItems": 500,
                                "type": "array"
                              },
                              "desiredFingerprint": {
                                "pattern": "^[a-z][a-z0-9-]*:[0-9a-f]{64}$",
                                "type": "string"
                              },
                              "jobId": {
                                "maxLength": 512,
                                "minLength": 1,
                                "type": "string"
                              },
                              "projectKey": {
                                "maxLength": 512,
                                "minLength": 1,
                                "type": "string"
                              },
                              "state": {
                                "enum": [
                                  "queued",
                                  "running",
                                  "committed",
                                  "covered",
                                  "superseded",
                                  "failed"
                                ],
                                "type": "string"
                              },
                              "updatedAt": {
                                "format": "date-time",
                                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                                "type": "string"
                              }
                            },
                            "required": [
                              "projectKey",
                              "jobId",
                              "acceptedRequestVersion",
                              "desiredFingerprint",
                              "desiredEvidenceVector",
                              "capturedScope",
                              "state",
                              "acceptedAt",
                              "updatedAt"
                            ],
                            "type": "object"
                          },
                          "state": {
                            "enum": [
                              "queued",
                              "running",
                              "retry_scheduled",
                              "failed"
                            ],
                            "type": "string"
                          },
                          "updatedAt": {
                            "format": "date-time",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "state",
                          "receipt",
                          "attempts",
                          "updatedAt"
                        ],
                        "type": "object"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "projectKey": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
                  },
                  "scope": {
                    "additionalProperties": false,
                    "properties": {
                      "excludedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "includedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      },
                      "isolatedSessions": {
                        "items": {
                          "maxLength": 512,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 500,
                        "type": "array"
                      }
                    },
                    "required": [
                      "includedSessions",
                      "excludedSessions",
                      "isolatedSessions"
                    ],
                    "type": "object"
                  }
                },
                "required": [
                  "projectKey",
                  "committed",
                  "pending",
                  "scope",
                  "autonomyMode",
                  "attentionCount"
                ],
                "type": "object"
              },
              "url": {
                "maxLength": 8192,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "url",
              "status"
            ],
            "type": "object"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "data"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "error": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "invalid_request",
                  "project_not_found",
                  "receipt_not_found",
                  "receipt_fingerprint_mismatch",
                  "evidence_vector_regression",
                  "evidence_snapshot_unavailable",
                  "project_compile_failed",
                  "snapshot_mismatch",
                  "claim_mismatch",
                  "provenance_mismatch",
                  "access_restricted",
                  "unsupported_locator",
                  "file_unavailable",
                  "upstream_timeout",
                  "upstream_unavailable",
                  "internal_error"
                ],
                "type": "string"
              },
              "details": {
                "additionalProperties": {
                  "anyOf": [
                    {
                      "maxLength": 4000,
                      "type": "string"
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "boolean"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "propertyNames": {
                  "maxLength": 128,
                  "minLength": 1,
                  "type": "string"
                },
                "type": "object"
              },
              "message": {
                "maxLength": 4000,
                "minLength": 1,
                "type": "string"
              },
              "retryable": {
                "type": "boolean"
              }
            },
            "required": [
              "code",
              "message",
              "retryable"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          }
        },
        "required": [
          "ok",
          "error"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "project-dag",
    "graph",
    "status"
  ],
  "title": "View Project DAG"
}
```

## `remote-ssh.bindings.get`

Reads the Remote SSH targets authorized for the caller workspace.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "binding": {
        "additionalProperties": false,
        "properties": {
          "allowedTargetIds": {
            "items": {
              "maxLength": 128,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "maxItems": 512,
            "type": "array"
          },
          "revision": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "schemaVersion": {
            "const": 2,
            "type": "number"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "workspaceId": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "workspaceId",
          "allowedTargetIds",
          "revision",
          "updatedAt"
        ],
        "type": "object"
      }
    },
    "required": [
      "binding"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "workspace",
    "authorization"
  ],
  "title": "Read workspace Remote SSH binding"
}
```

## `remote-ssh.bindings.save`

Updates the Remote SSH targets authorized for the caller workspace.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "allowedTargetIds": {
        "items": {
          "maxLength": 128,
          "minLength": 1,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          "type": "string"
        },
        "maxItems": 512,
        "type": "array"
      },
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "allowedTargetIds"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "binding": {
        "additionalProperties": false,
        "properties": {
          "allowedTargetIds": {
            "items": {
              "maxLength": 128,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "maxItems": 512,
            "type": "array"
          },
          "revision": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "schemaVersion": {
            "const": 2,
            "type": "number"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "workspaceId": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "workspaceId",
          "allowedTargetIds",
          "revision",
          "updatedAt"
        ],
        "type": "object"
      }
    },
    "required": [
      "binding"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "workspace",
    "authorization"
  ],
  "title": "Save workspace Remote SSH binding"
}
```

## `remote-ssh.command.cancel`

Cancels an active Remote SSH command owned by the caller workspace.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "executionId": {
        "description": "Caller-generated unique ID matching ssh_exec_ followed by 16-128 letters, digits, underscores, or hyphens.",
        "pattern": "^ssh_exec_[A-Za-z0-9_-]{16,128}$",
        "type": "string"
      }
    },
    "required": [
      "executionId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "cancelled": {
        "type": "boolean"
      },
      "executionId": {
        "description": "Caller-generated unique ID matching ssh_exec_ followed by 16-128 letters, digits, underscores, or hyphens.",
        "pattern": "^ssh_exec_[A-Za-z0-9_-]{16,128}$",
        "type": "string"
      }
    },
    "required": [
      "executionId",
      "cancelled"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "command",
    "cancellation"
  ],
  "title": "Cancel Remote SSH command"
}
```

## `remote-ssh.command.execute`

Executes a confirmed script on the authorized target through system OpenSSH.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `destructive`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "executionId": {
        "description": "Caller-generated unique ID matching ssh_exec_ followed by 16-128 letters, digits, underscores, or hyphens.",
        "pattern": "^ssh_exec_[A-Za-z0-9_-]{16,128}$",
        "type": "string"
      },
      "script": {
        "maxLength": 1000000,
        "minLength": 1,
        "type": "string"
      },
      "timeoutMs": {
        "maximum": 86400000,
        "minimum": 1000,
        "type": "integer"
      }
    },
    "required": [
      "executionId",
      "script"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "completedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "executionId": {
            "description": "Caller-generated unique ID matching ssh_exec_ followed by 16-128 letters, digits, underscores, or hyphens.",
            "pattern": "^ssh_exec_[A-Za-z0-9_-]{16,128}$",
            "type": "string"
          },
          "exitCode": {
            "const": 0,
            "type": "number"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "outputTruncated": {
            "type": "boolean"
          },
          "startedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "stderr": {
            "maxLength": 262144,
            "type": "string"
          },
          "stdout": {
            "maxLength": 262144,
            "type": "string"
          },
          "targetId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          }
        },
        "required": [
          "ok",
          "executionId",
          "targetId",
          "exitCode",
          "stdout",
          "stderr",
          "outputTruncated",
          "startedAt",
          "completedAt"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "completedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "executionId": {
            "description": "Caller-generated unique ID matching ssh_exec_ followed by 16-128 letters, digits, underscores, or hyphens.",
            "pattern": "^ssh_exec_[A-Za-z0-9_-]{16,128}$",
            "type": "string"
          },
          "failure": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "ssh_executable_missing",
                  "ssh_config_invalid",
                  "target_unreachable",
                  "target_auth_failed",
                  "host_key_rejected",
                  "environment_unavailable",
                  "vpn_login_required",
                  "environment_busy",
                  "transfer_limit_exceeded",
                  "local_file_unavailable",
                  "timeout",
                  "remote_exit_nonzero",
                  "cancelled"
                ],
                "type": "string"
              },
              "exitCode": {
                "maximum": 255,
                "minimum": 0,
                "type": "integer"
              },
              "message": {
                "maxLength": 2000,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "code",
              "message"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "outputTruncated": {
            "type": "boolean"
          },
          "startedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "stderr": {
            "maxLength": 262144,
            "type": "string"
          },
          "stdout": {
            "maxLength": 262144,
            "type": "string"
          },
          "targetId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          }
        },
        "required": [
          "ok",
          "executionId",
          "targetId",
          "stdout",
          "stderr",
          "outputTruncated",
          "failure",
          "completedAt"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "remote-ssh-target"
  ],
  "tags": [
    "remote-ssh",
    "command",
    "execution"
  ],
  "title": "Execute Remote SSH command"
}
```

## `remote-ssh.egress-session.open`

Authorizes this target as a network-egress hop for the caller workspace.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "authorizedSessionId": {
        "pattern": "^ssh_egs_[A-Za-z0-9_-]{24,128}$",
        "type": "string"
      },
      "expiresAt": {
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
        "type": "string"
      }
    },
    "required": [
      "authorizedSessionId",
      "expiresAt"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "remote-ssh-target"
  ],
  "tags": [
    "remote-ssh",
    "workspace-egress",
    "session"
  ],
  "title": "Authorize Remote SSH network egress"
}
```

## `remote-ssh.file.download`

Downloads one remote file into a workspace-relative destination.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `workspace-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "localPath": {
        "maxLength": 4096,
        "minLength": 1,
        "pattern": "^(?!\\/)(?![A-Za-z]:\\/)(?!.*(?:^|\\/)\\.\\.?(?:\\/|$))(?!.*\\/\\/)(?!.*\\/$)(?!.*\\\\).+$",
        "type": "string"
      },
      "remotePath": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "timeoutMs": {
        "maximum": 86400000,
        "minimum": 1000,
        "type": "integer"
      },
      "transferId": {
        "description": "Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.",
        "pattern": "^ssh_xfer_[A-Za-z0-9_-]{16,128}$",
        "type": "string"
      }
    },
    "required": [
      "transferId",
      "localPath",
      "remotePath"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "completedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "direction": {
            "const": "download",
            "type": "string"
          },
          "localPath": {
            "maxLength": 4096,
            "minLength": 1,
            "pattern": "^(?!\\/)(?![A-Za-z]:\\/)(?!.*(?:^|\\/)\\.\\.?(?:\\/|$))(?!.*\\/\\/)(?!.*\\/$)(?!.*\\\\).+$",
            "type": "string"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "remotePath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "sizeBytes": {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          },
          "targetId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "transferId": {
            "description": "Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.",
            "pattern": "^ssh_xfer_[A-Za-z0-9_-]{16,128}$",
            "type": "string"
          }
        },
        "required": [
          "ok",
          "transferId",
          "targetId",
          "direction",
          "localPath",
          "remotePath",
          "sizeBytes",
          "completedAt"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "completedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "direction": {
            "const": "download",
            "type": "string"
          },
          "failure": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "ssh_executable_missing",
                  "ssh_config_invalid",
                  "target_unreachable",
                  "target_auth_failed",
                  "host_key_rejected",
                  "environment_unavailable",
                  "vpn_login_required",
                  "environment_busy",
                  "transfer_limit_exceeded",
                  "local_file_unavailable",
                  "timeout",
                  "remote_exit_nonzero",
                  "cancelled"
                ],
                "type": "string"
              },
              "exitCode": {
                "maximum": 255,
                "minimum": 0,
                "type": "integer"
              },
              "message": {
                "maxLength": 2000,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "code",
              "message"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "targetId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "transferId": {
            "description": "Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.",
            "pattern": "^ssh_xfer_[A-Za-z0-9_-]{16,128}$",
            "type": "string"
          }
        },
        "required": [
          "ok",
          "transferId",
          "targetId",
          "direction",
          "failure",
          "completedAt"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "remote-ssh-target"
  ],
  "tags": [
    "remote-ssh",
    "file-transfer",
    "download"
  ],
  "title": "Download file over Remote SSH"
}
```

## `remote-ssh.file.upload`

Uploads one workspace-relative file to the authorized target.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "localPath": {
        "maxLength": 4096,
        "minLength": 1,
        "pattern": "^(?!\\/)(?![A-Za-z]:\\/)(?!.*(?:^|\\/)\\.\\.?(?:\\/|$))(?!.*\\/\\/)(?!.*\\/$)(?!.*\\\\).+$",
        "type": "string"
      },
      "remotePath": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "timeoutMs": {
        "maximum": 86400000,
        "minimum": 1000,
        "type": "integer"
      },
      "transferId": {
        "description": "Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.",
        "pattern": "^ssh_xfer_[A-Za-z0-9_-]{16,128}$",
        "type": "string"
      }
    },
    "required": [
      "transferId",
      "localPath",
      "remotePath"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "completedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "direction": {
            "const": "upload",
            "type": "string"
          },
          "localPath": {
            "maxLength": 4096,
            "minLength": 1,
            "pattern": "^(?!\\/)(?![A-Za-z]:\\/)(?!.*(?:^|\\/)\\.\\.?(?:\\/|$))(?!.*\\/\\/)(?!.*\\/$)(?!.*\\\\).+$",
            "type": "string"
          },
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "remotePath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "sizeBytes": {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          },
          "targetId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "transferId": {
            "description": "Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.",
            "pattern": "^ssh_xfer_[A-Za-z0-9_-]{16,128}$",
            "type": "string"
          }
        },
        "required": [
          "ok",
          "transferId",
          "targetId",
          "direction",
          "localPath",
          "remotePath",
          "sizeBytes",
          "completedAt"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "completedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "direction": {
            "const": "upload",
            "type": "string"
          },
          "failure": {
            "additionalProperties": false,
            "properties": {
              "code": {
                "enum": [
                  "ssh_executable_missing",
                  "ssh_config_invalid",
                  "target_unreachable",
                  "target_auth_failed",
                  "host_key_rejected",
                  "environment_unavailable",
                  "vpn_login_required",
                  "environment_busy",
                  "transfer_limit_exceeded",
                  "local_file_unavailable",
                  "timeout",
                  "remote_exit_nonzero",
                  "cancelled"
                ],
                "type": "string"
              },
              "exitCode": {
                "maximum": 255,
                "minimum": 0,
                "type": "integer"
              },
              "message": {
                "maxLength": 2000,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "code",
              "message"
            ],
            "type": "object"
          },
          "ok": {
            "const": false,
            "type": "boolean"
          },
          "targetId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "transferId": {
            "description": "Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.",
            "pattern": "^ssh_xfer_[A-Za-z0-9_-]{16,128}$",
            "type": "string"
          }
        },
        "required": [
          "ok",
          "transferId",
          "targetId",
          "direction",
          "failure",
          "completedAt"
        ],
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "remote-ssh-target"
  ],
  "tags": [
    "remote-ssh",
    "file-transfer",
    "upload"
  ],
  "title": "Upload file over Remote SSH"
}
```

## `remote-ssh.lab-environment.console.open`

Opens the configured VPN environment console for interactive sign-in.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "labId",
      "expectedRevision"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "presentation": {
        "oneOf": [
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "opened",
                "type": "string"
              }
            },
            "required": [
              "kind"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "external-url",
                "type": "string"
              },
              "url": {
                "format": "uri",
                "type": "string"
              }
            },
            "required": [
              "kind",
              "url"
            ],
            "type": "object"
          }
        ]
      }
    },
    "required": [
      "labId",
      "presentation"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "environment",
    "vpn",
    "console"
  ],
  "title": "Open laboratory VPN console"
}
```

## `remote-ssh.lab-environment.ensure`

Ensures the configured VPN environment is available and running.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "labId",
      "expectedRevision"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkedAt": {
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
        "type": "string"
      },
      "consoleAvailable": {
        "type": "boolean"
      },
      "guidanceCode": {
        "enum": [
          "install-provider",
          "select-environment",
          "start-environment",
          "wait-for-environment",
          "resume-environment",
          "install-host-openssh",
          "configure-gateway-alias",
          "trust-gateway-host-key",
          "authorize-gateway-key",
          "enable-gateway-ssh",
          "open-vpn-login",
          "test-target",
          "retry"
        ],
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "message": {
        "maxLength": 2000,
        "minLength": 1,
        "type": "string"
      },
      "provider": {
        "enum": [
          "vm",
          "docker"
        ],
        "type": "string"
      },
      "state": {
        "enum": [
          "provider-unavailable",
          "configuration-required",
          "stopped",
          "starting",
          "login-required",
          "ready",
          "failed"
        ],
        "type": "string"
      }
    },
    "required": [
      "labId",
      "provider",
      "state",
      "consoleAvailable",
      "checkedAt"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "environment",
    "vpn",
    "lifecycle"
  ],
  "title": "Ensure laboratory VPN environment"
}
```

## `remote-ssh.lab-environment.get`

Reads the configured VPN environment provider and connection state for one laboratory.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "labId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkedAt": {
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
        "type": "string"
      },
      "consoleAvailable": {
        "type": "boolean"
      },
      "guidanceCode": {
        "enum": [
          "install-provider",
          "select-environment",
          "start-environment",
          "wait-for-environment",
          "resume-environment",
          "install-host-openssh",
          "configure-gateway-alias",
          "trust-gateway-host-key",
          "authorize-gateway-key",
          "enable-gateway-ssh",
          "open-vpn-login",
          "test-target",
          "retry"
        ],
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "message": {
        "maxLength": 2000,
        "minLength": 1,
        "type": "string"
      },
      "provider": {
        "enum": [
          "vm",
          "docker"
        ],
        "type": "string"
      },
      "state": {
        "enum": [
          "provider-unavailable",
          "configuration-required",
          "stopped",
          "starting",
          "login-required",
          "ready",
          "failed"
        ],
        "type": "string"
      }
    },
    "required": [
      "labId",
      "provider",
      "state",
      "consoleAvailable",
      "checkedAt"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "environment",
    "vpn",
    "diagnostics"
  ],
  "title": "Inspect laboratory VPN environment"
}
```

## `remote-ssh.lab-environment.stop`

Stops the configured VPN environment while retaining its persistent state.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "labId",
      "expectedRevision"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkedAt": {
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
        "type": "string"
      },
      "consoleAvailable": {
        "type": "boolean"
      },
      "guidanceCode": {
        "enum": [
          "install-provider",
          "select-environment",
          "start-environment",
          "wait-for-environment",
          "resume-environment",
          "install-host-openssh",
          "configure-gateway-alias",
          "trust-gateway-host-key",
          "authorize-gateway-key",
          "enable-gateway-ssh",
          "open-vpn-login",
          "test-target",
          "retry"
        ],
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "message": {
        "maxLength": 2000,
        "minLength": 1,
        "type": "string"
      },
      "provider": {
        "enum": [
          "vm",
          "docker"
        ],
        "type": "string"
      },
      "state": {
        "enum": [
          "provider-unavailable",
          "configuration-required",
          "stopped",
          "starting",
          "login-required",
          "ready",
          "failed"
        ],
        "type": "string"
      }
    },
    "required": [
      "labId",
      "provider",
      "state",
      "consoleAvailable",
      "checkedAt"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "environment",
    "vpn",
    "lifecycle"
  ],
  "title": "Stop laboratory VPN environment"
}
```

## `remote-ssh.labs.delete`

Deletes one Remote SSH laboratory group.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "labId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "deletedLabId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "deletedLabId"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "configuration"
  ],
  "title": "Delete Remote SSH lab"
}
```

## `remote-ssh.labs.list`

Lists the laboratory groups configured for Remote SSH.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "labs": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "createdAt": {
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
              "type": "string"
            },
            "displayName": {
              "maxLength": 160,
              "minLength": 1,
              "type": "string"
            },
            "environment": {
              "oneOf": [
                {
                  "additionalProperties": false,
                  "properties": {
                    "driver": {
                      "const": "virtualbox",
                      "type": "string"
                    },
                    "gatewaySshAlias": {
                      "maxLength": 253,
                      "minLength": 1,
                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                      "type": "string"
                    },
                    "provider": {
                      "const": "vm",
                      "type": "string"
                    },
                    "vmId": {
                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                      "type": "string"
                    }
                  },
                  "required": [
                    "provider",
                    "driver",
                    "vmId",
                    "gatewaySshAlias"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "image": {
                      "maxLength": 512,
                      "minLength": 1,
                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$",
                      "type": "string"
                    },
                    "provider": {
                      "const": "docker",
                      "type": "string"
                    }
                  },
                  "required": [
                    "provider",
                    "image"
                  ],
                  "type": "object"
                }
              ]
            },
            "id": {
              "maxLength": 128,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "maxConcurrentExecutions": {
              "maximum": 128,
              "minimum": 1,
              "type": "integer"
            },
            "revision": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "schemaVersion": {
              "const": 2,
              "type": "number"
            },
            "updatedAt": {
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
              "type": "string"
            }
          },
          "required": [
            "schemaVersion",
            "id",
            "displayName",
            "environment",
            "maxConcurrentExecutions",
            "revision",
            "createdAt",
            "updatedAt"
          ],
          "type": "object"
        },
        "maxItems": 512,
        "type": "array"
      }
    },
    "required": [
      "labs"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "discovery"
  ],
  "title": "List Remote SSH labs"
}
```

## `remote-ssh.labs.save`

Creates or updates one Remote SSH laboratory group.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "displayName": {
        "maxLength": 160,
        "minLength": 1,
        "type": "string"
      },
      "environment": {
        "oneOf": [
          {
            "additionalProperties": false,
            "properties": {
              "driver": {
                "const": "virtualbox",
                "type": "string"
              },
              "gatewaySshAlias": {
                "maxLength": 253,
                "minLength": 1,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                "type": "string"
              },
              "provider": {
                "const": "vm",
                "type": "string"
              },
              "vmId": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "provider",
              "driver",
              "vmId",
              "gatewaySshAlias"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "image": {
                "maxLength": 512,
                "minLength": 1,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$",
                "type": "string"
              },
              "provider": {
                "const": "docker",
                "type": "string"
              }
            },
            "required": [
              "provider",
              "image"
            ],
            "type": "object"
          }
        ]
      },
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "id": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "maxConcurrentExecutions": {
        "maximum": 128,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": [
      "displayName",
      "environment",
      "maxConcurrentExecutions"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "lab": {
        "additionalProperties": false,
        "properties": {
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "displayName": {
            "maxLength": 160,
            "minLength": 1,
            "type": "string"
          },
          "environment": {
            "oneOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "driver": {
                    "const": "virtualbox",
                    "type": "string"
                  },
                  "gatewaySshAlias": {
                    "maxLength": 253,
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                    "type": "string"
                  },
                  "provider": {
                    "const": "vm",
                    "type": "string"
                  },
                  "vmId": {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                    "type": "string"
                  }
                },
                "required": [
                  "provider",
                  "driver",
                  "vmId",
                  "gatewaySshAlias"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "image": {
                    "maxLength": 512,
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$",
                    "type": "string"
                  },
                  "provider": {
                    "const": "docker",
                    "type": "string"
                  }
                },
                "required": [
                  "provider",
                  "image"
                ],
                "type": "object"
              }
            ]
          },
          "id": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "maxConcurrentExecutions": {
            "maximum": 128,
            "minimum": 1,
            "type": "integer"
          },
          "revision": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "schemaVersion": {
            "const": 2,
            "type": "number"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "id",
          "displayName",
          "environment",
          "maxConcurrentExecutions",
          "revision",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      }
    },
    "required": [
      "lab"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "lab",
    "configuration"
  ],
  "title": "Save Remote SSH lab"
}
```

## `remote-ssh.openssh-config.open`

Creates ~/.ssh/config when needed and opens it with the configured local editor.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "opened": {
        "const": true,
        "type": "boolean"
      }
    },
    "required": [
      "opened"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "openssh",
    "configuration"
  ],
  "title": "Open the local OpenSSH configuration"
}
```

## `remote-ssh.target.delete`

Deletes one logical OpenSSH target.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "targetId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "targetId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "deletedTargetId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "deletedTargetId"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "target",
    "configuration"
  ],
  "title": "Delete Remote SSH target"
}
```

## `remote-ssh.target.probe`

Tests final-target reachability through the canonical OpenSSH alias.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "checkedAt": {
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
        "type": "string"
      },
      "ready": {
        "type": "boolean"
      },
      "target": {
        "additionalProperties": false,
        "properties": {
          "latencyMs": {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          },
          "message": {
            "maxLength": 2000,
            "minLength": 1,
            "type": "string"
          },
          "status": {
            "enum": [
              "reachable",
              "unreachable",
              "auth-failed",
              "host-key-rejected",
              "not-configured",
              "not-tested"
            ],
            "type": "string"
          }
        },
        "required": [
          "status"
        ],
        "type": "object"
      },
      "targetId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "targetId",
      "target",
      "ready",
      "checkedAt"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "remote-ssh-target"
  ],
  "tags": [
    "remote-ssh",
    "target",
    "diagnostics"
  ],
  "title": "Probe Remote SSH target"
}
```

## `remote-ssh.target.save`

Creates or updates one logical OpenSSH target.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "capabilities": {
        "items": {
          "enum": [
            "shell",
            "file-transfer"
          ],
          "type": "string"
        },
        "maxItems": 2,
        "minItems": 1,
        "type": "array"
      },
      "displayName": {
        "maxLength": 160,
        "minLength": 1,
        "type": "string"
      },
      "expectedRevision": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "id": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "labId": {
        "maxLength": 128,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      },
      "labels": {
        "additionalProperties": {
          "maxLength": 256,
          "type": "string"
        },
        "propertyNames": {
          "maxLength": 64,
          "minLength": 1,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          "type": "string"
        },
        "type": "object"
      },
      "maxConcurrentExecutions": {
        "maximum": 128,
        "minimum": 1,
        "type": "integer"
      },
      "sshAlias": {
        "maxLength": 253,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        "type": "string"
      }
    },
    "required": [
      "labId",
      "displayName",
      "sshAlias",
      "labels",
      "capabilities",
      "maxConcurrentExecutions"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "target": {
        "additionalProperties": false,
        "properties": {
          "capabilities": {
            "items": {
              "enum": [
                "shell",
                "file-transfer"
              ],
              "type": "string"
            },
            "maxItems": 2,
            "minItems": 1,
            "type": "array"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "displayName": {
            "maxLength": 160,
            "minLength": 1,
            "type": "string"
          },
          "id": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "labId": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "labels": {
            "additionalProperties": {
              "maxLength": 256,
              "type": "string"
            },
            "propertyNames": {
              "maxLength": 64,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "type": "object"
          },
          "maxConcurrentExecutions": {
            "maximum": 128,
            "minimum": 1,
            "type": "integer"
          },
          "revision": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "schemaVersion": {
            "const": 2,
            "type": "number"
          },
          "sshAlias": {
            "maxLength": 253,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            "type": "string"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "id",
          "labId",
          "displayName",
          "sshAlias",
          "labels",
          "capabilities",
          "maxConcurrentExecutions",
          "revision",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      }
    },
    "required": [
      "target"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "target",
    "configuration"
  ],
  "title": "Save Remote SSH target"
}
```

## `remote-ssh.targets.catalog`

Lists full Remote SSH target configuration for the management UI.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "targets": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "capabilities": {
              "items": {
                "enum": [
                  "shell",
                  "file-transfer"
                ],
                "type": "string"
              },
              "maxItems": 2,
              "minItems": 1,
              "type": "array"
            },
            "createdAt": {
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
              "type": "string"
            },
            "displayName": {
              "maxLength": 160,
              "minLength": 1,
              "type": "string"
            },
            "id": {
              "maxLength": 128,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "labId": {
              "maxLength": 128,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "labels": {
              "additionalProperties": {
                "maxLength": 256,
                "type": "string"
              },
              "propertyNames": {
                "maxLength": 64,
                "minLength": 1,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                "type": "string"
              },
              "type": "object"
            },
            "maxConcurrentExecutions": {
              "maximum": 128,
              "minimum": 1,
              "type": "integer"
            },
            "revision": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "schemaVersion": {
              "const": 2,
              "type": "number"
            },
            "sshAlias": {
              "maxLength": 253,
              "minLength": 1,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
              "type": "string"
            },
            "updatedAt": {
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
              "type": "string"
            }
          },
          "required": [
            "schemaVersion",
            "id",
            "labId",
            "displayName",
            "sshAlias",
            "labels",
            "capabilities",
            "maxConcurrentExecutions",
            "revision",
            "createdAt",
            "updatedAt"
          ],
          "type": "object"
        },
        "maxItems": 512,
        "type": "array"
      }
    },
    "required": [
      "targets"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "target",
    "configuration"
  ],
  "title": "List Remote SSH target catalog"
}
```

## `remote-ssh.targets.list`

Lists Remote SSH targets authorized for the caller workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "targets": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "resource": {
              "additionalProperties": false,
              "properties": {
                "expiresAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "semanticRevision": {
                  "maxLength": 256,
                  "minLength": 1,
                  "type": "string"
                },
                "token": {
                  "pattern": "^cap_[A-Za-z0-9_-]{20,}$",
                  "type": "string"
                }
              },
              "required": [
                "token",
                "semanticRevision",
                "expiresAt"
              ],
              "type": "object"
            },
            "target": {
              "additionalProperties": false,
              "properties": {
                "capabilities": {
                  "items": {
                    "enum": [
                      "shell",
                      "file-transfer"
                    ],
                    "type": "string"
                  },
                  "maxItems": 2,
                  "minItems": 1,
                  "type": "array"
                },
                "displayName": {
                  "maxLength": 160,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 128,
                  "minLength": 1,
                  "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                  "type": "string"
                },
                "labId": {
                  "maxLength": 128,
                  "minLength": 1,
                  "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                  "type": "string"
                },
                "labels": {
                  "additionalProperties": {
                    "maxLength": 256,
                    "type": "string"
                  },
                  "propertyNames": {
                    "maxLength": 64,
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                    "type": "string"
                  },
                  "type": "object"
                },
                "maxConcurrentExecutions": {
                  "maximum": 128,
                  "minimum": 1,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "labId",
                "displayName",
                "labels",
                "capabilities",
                "maxConcurrentExecutions"
              ],
              "type": "object"
            }
          },
          "required": [
            "target",
            "resource"
          ],
          "type": "object"
        },
        "maxItems": 512,
        "type": "array"
      }
    },
    "required": [
      "targets"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "target",
    "discovery"
  ],
  "title": "List Remote SSH targets"
}
```

## `remote-ssh.virtualbox-machines.list`

Lists VirtualBox virtual machines available for Remote SSH laboratory isolation.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "available": {
        "type": "boolean"
      },
      "machines": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "architecture": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "name": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            },
            "osType": {
              "maxLength": 256,
              "minLength": 1,
              "type": "string"
            },
            "state": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "uuid": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
              "type": "string"
            }
          },
          "required": [
            "uuid",
            "name",
            "state"
          ],
          "type": "object"
        },
        "maxItems": 512,
        "type": "array"
      }
    },
    "required": [
      "available",
      "machines"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "remote-ssh",
    "virtualbox",
    "vm",
    "discovery"
  ],
  "title": "List VirtualBox machines"
}
```

## `remote-ssh.workspace-host-session.open`

Authorizes a private Remote Workspace host session on this target.

- Version: `1.0.0`
- Audiences: ui
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "egress": {
        "oneOf": [
          {
            "additionalProperties": false,
            "properties": {
              "mode": {
                "const": "none",
                "type": "string"
              }
            },
            "required": [
              "mode"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "allowlist": {
                "additionalProperties": false,
                "properties": {
                  "rules": {
                    "items": {
                      "additionalProperties": false,
                      "properties": {
                        "host": {
                          "maxLength": 253,
                          "minLength": 1,
                          "pattern": "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
                          "type": "string"
                        },
                        "ports": {
                          "items": {
                            "maximum": 65535,
                            "minimum": 1,
                            "type": "integer"
                          },
                          "maxItems": 32,
                          "minItems": 1,
                          "type": "array"
                        }
                      },
                      "required": [
                        "host",
                        "ports"
                      ],
                      "type": "object"
                    },
                    "maxItems": 128,
                    "minItems": 1,
                    "type": "array"
                  }
                },
                "required": [
                  "rules"
                ],
                "type": "object"
              },
              "mode": {
                "const": "local",
                "type": "string"
              }
            },
            "required": [
              "mode",
              "allowlist"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "allowlist": {
                "additionalProperties": false,
                "properties": {
                  "rules": {
                    "items": {
                      "additionalProperties": false,
                      "properties": {
                        "host": {
                          "maxLength": 253,
                          "minLength": 1,
                          "pattern": "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
                          "type": "string"
                        },
                        "ports": {
                          "items": {
                            "maximum": 65535,
                            "minimum": 1,
                            "type": "integer"
                          },
                          "maxItems": 32,
                          "minItems": 1,
                          "type": "array"
                        }
                      },
                      "required": [
                        "host",
                        "ports"
                      ],
                      "type": "object"
                    },
                    "maxItems": 128,
                    "minItems": 1,
                    "type": "array"
                  }
                },
                "required": [
                  "rules"
                ],
                "type": "object"
              },
              "authorizedSessionId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "mode": {
                "const": "remote-target",
                "type": "string"
              }
            },
            "required": [
              "mode",
              "authorizedSessionId",
              "allowlist"
            ],
            "type": "object"
          }
        ]
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "pattern": "^\\/(?:[^/\\0\\r\\n]+(?:\\/[^/\\0\\r\\n]+)*)?$",
        "type": "string"
      }
    },
    "required": [
      "workspaceRoot",
      "egress"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "authorizedSessionId": {
        "pattern": "^ssh_whs_[A-Za-z0-9_-]{24,128}$",
        "type": "string"
      },
      "providerId": {
        "const": "remote-ssh.workspace-host-provider",
        "type": "string"
      }
    },
    "required": [
      "providerId",
      "authorizedSessionId"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "remote-ssh-target"
  ],
  "tags": [
    "remote-ssh",
    "workspace-host",
    "session"
  ],
  "title": "Open Remote Workspace session"
}
```

## `surface.current`

Returns an opaque resource for the currently visible SciForge surface.

- Version: `2.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "surface",
    "visual",
    "discovery"
  ],
  "title": "Open current SciForge surface"
}
```

## `version-control.create-reference`

Creates or updates a package-safe reference in the owned Git repository.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "force": {
        "default": false,
        "type": "boolean"
      },
      "name": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "target": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "name",
      "target",
      "force"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "name": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "target": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "name",
      "target"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "reference"
  ],
  "title": "Create version-control reference"
}
```

## `version-control.create-snapshot`

Captures the current owned workspace without changing its files or index.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "label": {
        "maxLength": 500,
        "minLength": 1,
        "type": "string"
      },
      "metadata": {
        "allOf": [
          {
            "$ref": "#/definitions/__schema0"
          }
        ]
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "createdAt": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "id": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "label": {
        "maxLength": 500,
        "minLength": 1,
        "type": "string"
      },
      "metadata": {
        "allOf": [
          {
            "$ref": "#/definitions/__schema0"
          }
        ]
      },
      "revision": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "id",
      "revision",
      "createdAt"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "snapshot"
  ],
  "title": "Create version-control snapshot"
}
```

## `version-control.diff`

Reads a bounded diff between revisions in the owned Git workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "from": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "maxCharacters": {
        "maximum": 1000000,
        "minimum": 1,
        "type": "integer"
      },
      "paths": {
        "items": {
          "maxLength": 4096,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "to": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "from"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "text": {
        "maxLength": 1000000,
        "type": "string"
      },
      "truncated": {
        "type": "boolean"
      }
    },
    "required": [
      "text",
      "truncated"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "diff"
  ],
  "title": "Read version-control diff"
}
```

## `version-control.list-snapshots`

Lists bounded SciForge snapshots in the owned Git repository.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "cursor": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "limit": {
        "default": 100,
        "maximum": 1000,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": [
      "limit"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "nextCursor": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "snapshots": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "createdAt": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "id": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            },
            "label": {
              "maxLength": 500,
              "minLength": 1,
              "type": "string"
            },
            "metadata": {
              "allOf": [
                {
                  "$ref": "#/definitions/__schema0"
                }
              ]
            },
            "revision": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            }
          },
          "required": [
            "id",
            "revision",
            "createdAt"
          ],
          "type": "object"
        },
        "maxItems": 1000,
        "type": "array"
      }
    },
    "required": [
      "snapshots"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "snapshot"
  ],
  "title": "List version-control snapshots"
}
```

## `version-control.open-workspace`

Opens an owner-bound Git workspace through the host version-control provider.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "workspaceRoot"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "provider": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "resource": {
        "additionalProperties": false,
        "properties": {
          "expiresAt": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "semanticRevision": {
            "maxLength": 512,
            "minLength": 1,
            "type": "string"
          },
          "token": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "token",
          "semanticRevision",
          "expiresAt"
        ],
        "type": "object"
      },
      "resourceKind": {
        "const": "host.version-control.workspace",
        "type": "string"
      }
    },
    "required": [
      "resourceKind",
      "resource",
      "provider"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "git",
    "version-control",
    "workspace"
  ],
  "title": "Open version-control workspace"
}
```

## `version-control.preview-restore`

Reads the bounded patch for a prospective workspace restore.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "from": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "maxCharacters": {
        "maximum": 1000000,
        "minimum": 1,
        "type": "integer"
      },
      "paths": {
        "items": {
          "maxLength": 4096,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "to": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "from"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "text": {
        "maxLength": 1000000,
        "type": "string"
      },
      "truncated": {
        "type": "boolean"
      }
    },
    "required": [
      "text",
      "truncated"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "restore",
    "preview"
  ],
  "title": "Preview version-control restore"
}
```

## `version-control.read-file`

Reads bounded file content from a revision in the owned Git workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "maxCharacters": {
        "maximum": 1000000,
        "minimum": 1,
        "type": "integer"
      },
      "path": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "revision": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "revision",
      "path"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "content": {
        "maxLength": 1000000,
        "type": "string"
      },
      "truncated": {
        "type": "boolean"
      }
    },
    "required": [
      "content",
      "truncated"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "file"
  ],
  "title": "Read version-controlled file"
}
```

## `version-control.restore`

Destructively restores the owned workspace to a selected revision.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `destructive`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "paths": {
        "items": {
          "maxLength": 4096,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "target": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "target"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "revision": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "revision"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "restore"
  ],
  "title": "Restore version-control workspace"
}
```

## `version-control.status`

Reads the bounded change status of an owned Git workspace.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "changes": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "path": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "previousPath": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "status": {
              "enum": [
                "added",
                "modified",
                "deleted",
                "renamed",
                "copied",
                "untracked",
                "conflicted"
              ],
              "type": "string"
            }
          },
          "required": [
            "path",
            "status"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "clean": {
        "type": "boolean"
      },
      "revision": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "truncated": {
        "type": "boolean"
      }
    },
    "required": [
      "revision",
      "clean",
      "changes",
      "truncated"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "host.version-control.workspace"
  ],
  "tags": [
    "git",
    "version-control",
    "status"
  ],
  "title": "Read version-control status"
}
```

## `visual-review.accept-candidate`

Atomically accepts the active candidate and preserves the previous image as a backup.

- Version: `1.0.0`
- Audiences: ui
- Effect: `destructive`
- Approval: confirmation
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      },
      "revisionId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId",
      "revisionId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "revision": {
        "additionalProperties": false,
        "properties": {
          "artifactHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "artifactPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "backupPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "basedOnHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "decidedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          },
          "id": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "reviewEvidence": {
            "additionalProperties": false,
            "properties": {
              "ok": {
                "const": true,
                "type": "boolean"
              },
              "repairable": {
                "const": false,
                "type": "boolean"
              },
              "reviewedArtifactHash": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "reviewedArtifactPath": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "reviewedAt": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "score": {
                "additionalProperties": false,
                "properties": {
                  "background": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "dimensions": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "nonEmpty": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "overall": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "reference": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "semantic": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "warnings": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  }
                },
                "required": [
                  "overall",
                  "dimensions",
                  "nonEmpty",
                  "background",
                  "semantic",
                  "warnings"
                ],
                "type": "object"
              },
              "semantic": {
                "additionalProperties": false,
                "properties": {
                  "pass": {
                    "const": true,
                    "type": "boolean"
                  },
                  "repairInstructions": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  },
                  "summary": {
                    "maxLength": 20000,
                    "type": "string"
                  },
                  "violations": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  }
                },
                "required": [
                  "pass",
                  "summary",
                  "violations",
                  "repairInstructions"
                ],
                "type": "object"
              },
              "tool": {
                "const": "image_generation_review_candidate",
                "type": "string"
              },
              "warnings": {
                "items": {
                  "maxLength": 10000,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              }
            },
            "required": [
              "tool",
              "ok",
              "reviewedArtifactPath",
              "reviewedArtifactHash",
              "reviewedAt",
              "score",
              "semantic",
              "repairable",
              "warnings"
            ],
            "type": "object"
          },
          "status": {
            "enum": [
              "candidate",
              "accepted",
              "rejected"
            ],
            "type": "string"
          },
          "summary": {
            "maxLength": 20000,
            "minLength": 1,
            "type": "string"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          }
        },
        "required": [
          "id",
          "status",
          "basedOnHash",
          "artifactPath",
          "artifactHash",
          "summary",
          "reviewEvidence",
          "createdAt"
        ],
        "type": "object"
      },
      "status": {
        "enum": [
          "accepted",
          "rejected"
        ],
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "revision",
      "document"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Accept Visual Review candidate"
}
```

## `visual-review.apply-style-reference`

Extracts a manuscript visual style from one reference image and applies it to the current Visual Review document.

- Version: `1.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      },
      "sourcePath": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId",
      "sourcePath"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "profile": {
        "additionalProperties": false,
        "properties": {
          "confidence": {
            "maximum": 1,
            "minimum": 0,
            "type": "number"
          },
          "id": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "palette": {
            "additionalProperties": false,
            "properties": {
              "accent": {
                "items": {
                  "maxLength": 100,
                  "minLength": 1,
                  "type": "string"
                },
                "maxItems": 32,
                "type": "array"
              },
              "colors": {
                "items": {
                  "maxLength": 100,
                  "minLength": 1,
                  "type": "string"
                },
                "maxItems": 64,
                "minItems": 1,
                "type": "array"
              }
            },
            "required": [
              "colors",
              "accent"
            ],
            "type": "object"
          },
          "semanticDescription": {
            "maxLength": 20000,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "id",
          "semanticDescription",
          "palette",
          "confidence"
        ],
        "type": "object"
      },
      "status": {
        "const": "style_applied",
        "type": "string"
      },
      "styleProfileRef": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "document",
      "styleProfileRef",
      "profile"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Apply Visual Review style reference"
}
```

## `visual-review.create-candidate`

Stages one non-destructive candidate after validated image-generation QA.

- Version: `1.0.0`
- Audiences: agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "candidatePath": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      },
      "expectedBaseHash": {
        "pattern": "^[a-f0-9]{64}$",
        "type": "string"
      },
      "height": {
        "exclusiveMinimum": 0,
        "maximum": 100000,
        "type": "integer"
      },
      "reviewEvidence": {
        "additionalProperties": false,
        "properties": {
          "ok": {
            "const": true,
            "type": "boolean"
          },
          "repairable": {
            "const": false,
            "type": "boolean"
          },
          "reviewedArtifactHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "reviewedArtifactPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "reviewedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "score": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maximum": 1,
                "minimum": 0,
                "type": "number"
              },
              "dimensions": {
                "maximum": 1,
                "minimum": 0,
                "type": "number"
              },
              "nonEmpty": {
                "maximum": 1,
                "minimum": 0,
                "type": "number"
              },
              "overall": {
                "maximum": 1,
                "minimum": 0,
                "type": "number"
              },
              "reference": {
                "maximum": 1,
                "minimum": 0,
                "type": "number"
              },
              "semantic": {
                "maximum": 1,
                "minimum": 0,
                "type": "number"
              },
              "warnings": {
                "items": {
                  "maxLength": 10000,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              }
            },
            "required": [
              "overall",
              "dimensions",
              "nonEmpty",
              "background",
              "semantic",
              "warnings"
            ],
            "type": "object"
          },
          "semantic": {
            "additionalProperties": false,
            "properties": {
              "pass": {
                "const": true,
                "type": "boolean"
              },
              "repairInstructions": {
                "items": {
                  "maxLength": 10000,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              },
              "summary": {
                "maxLength": 20000,
                "type": "string"
              },
              "violations": {
                "items": {
                  "maxLength": 10000,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              }
            },
            "required": [
              "pass",
              "summary",
              "violations",
              "repairInstructions"
            ],
            "type": "object"
          },
          "tool": {
            "const": "image_generation_review_candidate",
            "type": "string"
          },
          "warnings": {
            "items": {
              "maxLength": 10000,
              "type": "string"
            },
            "maxItems": 1000,
            "type": "array"
          }
        },
        "required": [
          "tool",
          "ok",
          "reviewedArtifactPath",
          "reviewedArtifactHash",
          "reviewedAt",
          "score",
          "semantic",
          "repairable",
          "warnings"
        ],
        "type": "object"
      },
      "summary": {
        "maxLength": 20000,
        "minLength": 1,
        "type": "string"
      },
      "width": {
        "exclusiveMinimum": 0,
        "maximum": 100000,
        "type": "integer"
      }
    },
    "required": [
      "documentId",
      "candidatePath",
      "summary",
      "reviewEvidence"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "revision": {
        "additionalProperties": false,
        "properties": {
          "artifactHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "artifactPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "backupPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "basedOnHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "decidedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          },
          "id": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "reviewEvidence": {
            "additionalProperties": false,
            "properties": {
              "ok": {
                "const": true,
                "type": "boolean"
              },
              "repairable": {
                "const": false,
                "type": "boolean"
              },
              "reviewedArtifactHash": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "reviewedArtifactPath": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "reviewedAt": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "score": {
                "additionalProperties": false,
                "properties": {
                  "background": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "dimensions": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "nonEmpty": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "overall": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "reference": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "semantic": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "warnings": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  }
                },
                "required": [
                  "overall",
                  "dimensions",
                  "nonEmpty",
                  "background",
                  "semantic",
                  "warnings"
                ],
                "type": "object"
              },
              "semantic": {
                "additionalProperties": false,
                "properties": {
                  "pass": {
                    "const": true,
                    "type": "boolean"
                  },
                  "repairInstructions": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  },
                  "summary": {
                    "maxLength": 20000,
                    "type": "string"
                  },
                  "violations": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  }
                },
                "required": [
                  "pass",
                  "summary",
                  "violations",
                  "repairInstructions"
                ],
                "type": "object"
              },
              "tool": {
                "const": "image_generation_review_candidate",
                "type": "string"
              },
              "warnings": {
                "items": {
                  "maxLength": 10000,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              }
            },
            "required": [
              "tool",
              "ok",
              "reviewedArtifactPath",
              "reviewedArtifactHash",
              "reviewedAt",
              "score",
              "semantic",
              "repairable",
              "warnings"
            ],
            "type": "object"
          },
          "status": {
            "enum": [
              "candidate",
              "accepted",
              "rejected"
            ],
            "type": "string"
          },
          "summary": {
            "maxLength": 20000,
            "minLength": 1,
            "type": "string"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          }
        },
        "required": [
          "id",
          "status",
          "basedOnHash",
          "artifactPath",
          "artifactHash",
          "summary",
          "reviewEvidence",
          "createdAt"
        ],
        "type": "object"
      },
      "status": {
        "const": "candidate_created",
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "revision",
      "document"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Create Visual Review candidate"
}
```

## `visual-review.export-review-packet`

Exports the current open annotations and immutable source context for revision.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "packet": {
        "additionalProperties": false,
        "properties": {
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "packetId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "revisionContext": {
            "additionalProperties": false,
            "properties": {
              "acceptedRevisionId": {
                "anyOf": [
                  {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "activeCandidateRevisionId": {
                "anyOf": [
                  {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "preserve": {
                "items": {
                  "maxLength": 20000,
                  "type": "string"
                },
                "maxItems": 10000,
                "type": "array"
              },
              "selectedNodeIds": {
                "items": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "maxItems": 10000,
                "type": "array"
              },
              "selectedRegions": {
                "items": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "maxItems": 10000,
                "type": "array"
              }
            },
            "required": [
              "acceptedRevisionId",
              "activeCandidateRevisionId",
              "selectedRegions",
              "selectedNodeIds",
              "preserve"
            ],
            "type": "object"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "sourceArtifact": {
            "additionalProperties": false,
            "properties": {
              "caption": {
                "maxLength": 10000,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              },
              "id": {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              "kind": {
                "enum": [
                  "image",
                  "generated_image",
                  "edited_image",
                  "scientific_plot",
                  "presentation_slide"
                ],
                "type": "string"
              },
              "manifestPath": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "mimeType": {
                "maxLength": 200,
                "minLength": 1,
                "type": "string"
              },
              "sourceHash": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "sourcePath": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "title": {
                "maxLength": 1000,
                "minLength": 1,
                "type": "string"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              },
              "workingCopyHash": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "workingCopyPath": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "id",
              "kind",
              "sourcePath",
              "sourceHash",
              "workingCopyPath",
              "workingCopyHash"
            ],
            "type": "object"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          }
        },
        "required": [
          "schemaVersion",
          "packetId",
          "documentId",
          "createdAt",
          "sourceArtifact",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisionContext"
        ],
        "type": "object"
      },
      "packetPath": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "status": {
        "const": "exported",
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "packet",
      "packetPath"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Export Visual Review packet"
}
```

## `visual-review.open`

Opens or creates the canonical Visual Review document and optionally stages one source artifact.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "artifact": {
        "additionalProperties": false,
        "properties": {
          "caption": {
            "maxLength": 10000,
            "minLength": 1,
            "type": "string"
          },
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          },
          "kind": {
            "enum": [
              "image",
              "generated_image",
              "edited_image",
              "scientific_plot",
              "presentation_slide"
            ],
            "type": "string"
          },
          "manifestPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "mimeType": {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          "sourcePath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "title": {
            "maxLength": 1000,
            "minLength": 1,
            "type": "string"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          }
        },
        "required": [
          "kind",
          "sourcePath"
        ],
        "type": "object"
      },
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "paths": {
        "additionalProperties": false,
        "properties": {
          "assetsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "backupsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "documentDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "documentPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "reviewPacketsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "revisionsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "documentDir",
          "documentPath",
          "assetsDir",
          "revisionsDir",
          "backupsDir",
          "reviewPacketsDir"
        ],
        "type": "object"
      },
      "status": {
        "enum": [
          "created",
          "opened"
        ],
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "workspaceRoot",
      "document",
      "paths"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Open Visual Review document"
}
```

## `visual-review.read-document`

Reads one existing canonical Visual Review document without creating it.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "paths": {
        "additionalProperties": false,
        "properties": {
          "assetsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "backupsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "documentDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "documentPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "reviewPacketsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "revisionsDir": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "documentDir",
          "documentPath",
          "assetsDir",
          "revisionsDir",
          "backupsDir",
          "reviewPacketsDir"
        ],
        "type": "object"
      },
      "status": {
        "enum": [
          "created",
          "opened"
        ],
        "type": "string"
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "workspaceRoot",
      "document",
      "paths"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Read Visual Review document"
}
```

## `visual-review.read-image`

Reads one bounded workspace image for the package-owned review surface.

- Version: `1.0.0`
- Audiences: ui
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "path": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "path"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "dataUrl": {
        "maxLength": 67108864,
        "pattern": "^data:.*",
        "type": "string"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      }
    },
    "required": [
      "ok",
      "dataUrl"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Read Visual Review image"
}
```

## `visual-review.reject-candidate`

Rejects the active candidate without replacing the source image.

- Version: `1.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      },
      "revisionId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId",
      "revisionId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "revision": {
        "additionalProperties": false,
        "properties": {
          "artifactHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "artifactPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "backupPath": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          "basedOnHash": {
            "pattern": "^[a-f0-9]{64}$",
            "type": "string"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "decidedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          },
          "id": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "reviewEvidence": {
            "additionalProperties": false,
            "properties": {
              "ok": {
                "const": true,
                "type": "boolean"
              },
              "repairable": {
                "const": false,
                "type": "boolean"
              },
              "reviewedArtifactHash": {
                "pattern": "^[a-f0-9]{64}$",
                "type": "string"
              },
              "reviewedArtifactPath": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "reviewedAt": {
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                "type": "string"
              },
              "score": {
                "additionalProperties": false,
                "properties": {
                  "background": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "dimensions": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "nonEmpty": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "overall": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "reference": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "semantic": {
                    "maximum": 1,
                    "minimum": 0,
                    "type": "number"
                  },
                  "warnings": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  }
                },
                "required": [
                  "overall",
                  "dimensions",
                  "nonEmpty",
                  "background",
                  "semantic",
                  "warnings"
                ],
                "type": "object"
              },
              "semantic": {
                "additionalProperties": false,
                "properties": {
                  "pass": {
                    "const": true,
                    "type": "boolean"
                  },
                  "repairInstructions": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  },
                  "summary": {
                    "maxLength": 20000,
                    "type": "string"
                  },
                  "violations": {
                    "items": {
                      "maxLength": 10000,
                      "type": "string"
                    },
                    "maxItems": 1000,
                    "type": "array"
                  }
                },
                "required": [
                  "pass",
                  "summary",
                  "violations",
                  "repairInstructions"
                ],
                "type": "object"
              },
              "tool": {
                "const": "image_generation_review_candidate",
                "type": "string"
              },
              "warnings": {
                "items": {
                  "maxLength": 10000,
                  "type": "string"
                },
                "maxItems": 1000,
                "type": "array"
              }
            },
            "required": [
              "tool",
              "ok",
              "reviewedArtifactPath",
              "reviewedArtifactHash",
              "reviewedAt",
              "score",
              "semantic",
              "repairable",
              "warnings"
            ],
            "type": "object"
          },
          "status": {
            "enum": [
              "candidate",
              "accepted",
              "rejected"
            ],
            "type": "string"
          },
          "summary": {
            "maxLength": 20000,
            "minLength": 1,
            "type": "string"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 100000,
            "type": "integer"
          }
        },
        "required": [
          "id",
          "status",
          "basedOnHash",
          "artifactPath",
          "artifactHash",
          "summary",
          "reviewEvidence",
          "createdAt"
        ],
        "type": "object"
      },
      "status": {
        "enum": [
          "accepted",
          "rejected"
        ],
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "revision",
      "document"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Reject Visual Review candidate"
}
```

## `visual-review.save-annotations`

Replaces the structured annotation set for one Visual Review document.

- Version: `1.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "annotations": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "geometry": {
              "oneOf": [
                {
                  "additionalProperties": false,
                  "properties": {
                    "bounds": {
                      "additionalProperties": false,
                      "properties": {
                        "height": {
                          "exclusiveMinimum": 0,
                          "maximum": 1,
                          "type": "number"
                        },
                        "width": {
                          "exclusiveMinimum": 0,
                          "maximum": 1,
                          "type": "number"
                        },
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y",
                        "width",
                        "height"
                      ],
                      "type": "object"
                    },
                    "kind": {
                      "const": "box",
                      "type": "string"
                    }
                  },
                  "required": [
                    "kind",
                    "bounds"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "kind": {
                      "const": "pin",
                      "type": "string"
                    },
                    "point": {
                      "additionalProperties": false,
                      "properties": {
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y"
                      ],
                      "type": "object"
                    }
                  },
                  "required": [
                    "kind",
                    "point"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "from": {
                      "additionalProperties": false,
                      "properties": {
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y"
                      ],
                      "type": "object"
                    },
                    "kind": {
                      "const": "arrow",
                      "type": "string"
                    },
                    "to": {
                      "additionalProperties": false,
                      "properties": {
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y"
                      ],
                      "type": "object"
                    }
                  },
                  "required": [
                    "kind",
                    "from",
                    "to"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "kind": {
                      "const": "freehand",
                      "type": "string"
                    },
                    "points": {
                      "items": {
                        "additionalProperties": false,
                        "properties": {
                          "x": {
                            "maximum": 1,
                            "minimum": 0,
                            "type": "number"
                          },
                          "y": {
                            "maximum": 1,
                            "minimum": 0,
                            "type": "number"
                          }
                        },
                        "required": [
                          "x",
                          "y"
                        ],
                        "type": "object"
                      },
                      "maxItems": 20000,
                      "minItems": 2,
                      "type": "array"
                    }
                  },
                  "required": [
                    "kind",
                    "points"
                  ],
                  "type": "object"
                }
              ]
            },
            "id": {
              "maxLength": 120,
              "minLength": 1,
              "type": "string"
            },
            "instruction": {
              "maxLength": 20000,
              "minLength": 1,
              "type": "string"
            },
            "status": {
              "enum": [
                "open",
                "resolved"
              ],
              "type": "string"
            },
            "targetNodeIds": {
              "items": {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              "maxItems": 10000,
              "type": "array"
            }
          },
          "required": [
            "geometry",
            "instruction"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "documentId",
      "annotations"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "annotations": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "createdAt": {
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
              "type": "string"
            },
            "geometry": {
              "oneOf": [
                {
                  "additionalProperties": false,
                  "properties": {
                    "bounds": {
                      "additionalProperties": false,
                      "properties": {
                        "height": {
                          "exclusiveMinimum": 0,
                          "maximum": 1,
                          "type": "number"
                        },
                        "width": {
                          "exclusiveMinimum": 0,
                          "maximum": 1,
                          "type": "number"
                        },
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y",
                        "width",
                        "height"
                      ],
                      "type": "object"
                    },
                    "kind": {
                      "const": "box",
                      "type": "string"
                    }
                  },
                  "required": [
                    "kind",
                    "bounds"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "kind": {
                      "const": "pin",
                      "type": "string"
                    },
                    "point": {
                      "additionalProperties": false,
                      "properties": {
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y"
                      ],
                      "type": "object"
                    }
                  },
                  "required": [
                    "kind",
                    "point"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "from": {
                      "additionalProperties": false,
                      "properties": {
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y"
                      ],
                      "type": "object"
                    },
                    "kind": {
                      "const": "arrow",
                      "type": "string"
                    },
                    "to": {
                      "additionalProperties": false,
                      "properties": {
                        "x": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "y": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        }
                      },
                      "required": [
                        "x",
                        "y"
                      ],
                      "type": "object"
                    }
                  },
                  "required": [
                    "kind",
                    "from",
                    "to"
                  ],
                  "type": "object"
                },
                {
                  "additionalProperties": false,
                  "properties": {
                    "kind": {
                      "const": "freehand",
                      "type": "string"
                    },
                    "points": {
                      "items": {
                        "additionalProperties": false,
                        "properties": {
                          "x": {
                            "maximum": 1,
                            "minimum": 0,
                            "type": "number"
                          },
                          "y": {
                            "maximum": 1,
                            "minimum": 0,
                            "type": "number"
                          }
                        },
                        "required": [
                          "x",
                          "y"
                        ],
                        "type": "object"
                      },
                      "maxItems": 20000,
                      "minItems": 2,
                      "type": "array"
                    }
                  },
                  "required": [
                    "kind",
                    "points"
                  ],
                  "type": "object"
                }
              ]
            },
            "id": {
              "maxLength": 120,
              "minLength": 1,
              "type": "string"
            },
            "instruction": {
              "maxLength": 20000,
              "minLength": 1,
              "type": "string"
            },
            "kind": {
              "enum": [
                "box",
                "arrow",
                "freehand",
                "pin"
              ],
              "type": "string"
            },
            "status": {
              "enum": [
                "open",
                "resolved"
              ],
              "type": "string"
            },
            "targetNodeIds": {
              "items": {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              "maxItems": 10000,
              "type": "array"
            },
            "updatedAt": {
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
              "type": "string"
            }
          },
          "required": [
            "id",
            "kind",
            "geometry",
            "instruction",
            "targetNodeIds",
            "status",
            "createdAt",
            "updatedAt"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "status": {
        "const": "saved",
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "annotations",
      "document"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Save Visual Review annotations"
}
```

## `visual-review.update-context`

Updates the canonical visual nodes, truth locks, or style reference.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "documentId": {
        "maxLength": 120,
        "minLength": 1,
        "type": "string"
      },
      "nodes": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "assetPath": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "bounds": {
              "additionalProperties": false,
              "properties": {
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 1,
                  "type": "number"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 1,
                  "type": "number"
                },
                "x": {
                  "maximum": 1,
                  "minimum": 0,
                  "type": "number"
                },
                "y": {
                  "maximum": 1,
                  "minimum": 0,
                  "type": "number"
                }
              },
              "required": [
                "x",
                "y",
                "width",
                "height"
              ],
              "type": "object"
            },
            "childIds": {
              "items": {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              "maxItems": 10000,
              "type": "array"
            },
            "editable": {
              "type": "boolean"
            },
            "id": {
              "maxLength": 120,
              "minLength": 1,
              "type": "string"
            },
            "kind": {
              "enum": [
                "generated_asset",
                "scientific_plot",
                "text",
                "shape",
                "connector",
                "group"
              ],
              "type": "string"
            },
            "maskPath": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "parentId": {
              "maxLength": 120,
              "minLength": 1,
              "type": "string"
            },
            "semanticRef": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "sourceSpecRef": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "style": {
              "additionalProperties": {
                "$ref": "#/definitions/__schema0"
              },
              "propertyNames": {
                "type": "string"
              },
              "type": "object"
            },
            "truthLocked": {
              "type": "boolean"
            }
          },
          "required": [
            "id",
            "kind",
            "bounds",
            "editable",
            "truthLocked"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      },
      "styleProfileRef": {
        "anyOf": [
          {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "truthLocks": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "description": {
              "maxLength": 20000,
              "minLength": 1,
              "type": "string"
            },
            "id": {
              "maxLength": 120,
              "minLength": 1,
              "type": "string"
            },
            "nodeIds": {
              "items": {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              "maxItems": 10000,
              "type": "array"
            },
            "sourceRef": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            }
          },
          "required": [
            "id",
            "description",
            "nodeIds"
          ],
          "type": "object"
        },
        "maxItems": 10000,
        "type": "array"
      }
    },
    "required": [
      "documentId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 100000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 10000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 192,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "document": {
        "additionalProperties": false,
        "properties": {
          "acceptedRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "activeCandidateRevisionId": {
            "anyOf": [
              {
                "maxLength": 120,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "annotations": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "geometry": {
                  "oneOf": [
                    {
                      "additionalProperties": false,
                      "properties": {
                        "bounds": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "width": {
                              "exclusiveMinimum": 0,
                              "maximum": 1,
                              "type": "number"
                            },
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y",
                            "width",
                            "height"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "box",
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "bounds"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "pin",
                          "type": "string"
                        },
                        "point": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "point"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "from": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        },
                        "kind": {
                          "const": "arrow",
                          "type": "string"
                        },
                        "to": {
                          "additionalProperties": false,
                          "properties": {
                            "x": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            },
                            "y": {
                              "maximum": 1,
                              "minimum": 0,
                              "type": "number"
                            }
                          },
                          "required": [
                            "x",
                            "y"
                          ],
                          "type": "object"
                        }
                      },
                      "required": [
                        "kind",
                        "from",
                        "to"
                      ],
                      "type": "object"
                    },
                    {
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "const": "freehand",
                          "type": "string"
                        },
                        "points": {
                          "items": {
                            "additionalProperties": false,
                            "properties": {
                              "x": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              },
                              "y": {
                                "maximum": 1,
                                "minimum": 0,
                                "type": "number"
                              }
                            },
                            "required": [
                              "x",
                              "y"
                            ],
                            "type": "object"
                          },
                          "maxItems": 20000,
                          "minItems": 2,
                          "type": "array"
                        }
                      },
                      "required": [
                        "kind",
                        "points"
                      ],
                      "type": "object"
                    }
                  ]
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "instruction": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "box",
                    "arrow",
                    "freehand",
                    "pin"
                  ],
                  "type": "string"
                },
                "status": {
                  "enum": [
                    "open",
                    "resolved"
                  ],
                  "type": "string"
                },
                "targetNodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "updatedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                }
              },
              "required": [
                "id",
                "kind",
                "geometry",
                "instruction",
                "targetNodeIds",
                "status",
                "createdAt",
                "updatedAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "artifact": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "caption": {
                    "maxLength": 10000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "id": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "image",
                      "generated_image",
                      "edited_image",
                      "scientific_plot",
                      "presentation_slide"
                    ],
                    "type": "string"
                  },
                  "manifestPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "mimeType": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string"
                  },
                  "sourceHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "sourcePath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  },
                  "title": {
                    "maxLength": 1000,
                    "minLength": 1,
                    "type": "string"
                  },
                  "width": {
                    "exclusiveMinimum": 0,
                    "maximum": 100000,
                    "type": "integer"
                  },
                  "workingCopyHash": {
                    "pattern": "^[a-f0-9]{64}$",
                    "type": "string"
                  },
                  "workingCopyPath": {
                    "maxLength": 4096,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "kind",
                  "sourcePath",
                  "sourceHash",
                  "workingCopyPath",
                  "workingCopyHash"
                ],
                "type": "object"
              },
              {
                "type": "null"
              }
            ]
          },
          "canvas": {
            "additionalProperties": false,
            "properties": {
              "background": {
                "maxLength": 512,
                "minLength": 1,
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "number"
              }
            },
            "required": [
              "width",
              "height",
              "background"
            ],
            "type": "object"
          },
          "createdAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "documentId": {
            "maxLength": 120,
            "minLength": 1,
            "type": "string"
          },
          "nodes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "assetPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "bounds": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "childIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "editable": {
                  "type": "boolean"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "kind": {
                  "enum": [
                    "generated_asset",
                    "scientific_plot",
                    "text",
                    "shape",
                    "connector",
                    "group"
                  ],
                  "type": "string"
                },
                "maskPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "parentId": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "semanticRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "sourceSpecRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "style": {
                  "additionalProperties": {
                    "$ref": "#/definitions/__schema0"
                  },
                  "propertyNames": {
                    "type": "string"
                  },
                  "type": "object"
                },
                "truthLocked": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "kind",
                "bounds",
                "editable",
                "truthLocked"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "artifactHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "artifactPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "backupPath": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                },
                "basedOnHash": {
                  "pattern": "^[a-f0-9]{64}$",
                  "type": "string"
                },
                "createdAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "decidedAt": {
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                  "type": "string"
                },
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "reviewEvidence": {
                  "additionalProperties": false,
                  "properties": {
                    "ok": {
                      "const": true,
                      "type": "boolean"
                    },
                    "repairable": {
                      "const": false,
                      "type": "boolean"
                    },
                    "reviewedArtifactHash": {
                      "pattern": "^[a-f0-9]{64}$",
                      "type": "string"
                    },
                    "reviewedArtifactPath": {
                      "maxLength": 4096,
                      "minLength": 1,
                      "type": "string"
                    },
                    "reviewedAt": {
                      "format": "date-time",
                      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
                      "type": "string"
                    },
                    "score": {
                      "additionalProperties": false,
                      "properties": {
                        "background": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "dimensions": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "nonEmpty": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "overall": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "reference": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "semantic": {
                          "maximum": 1,
                          "minimum": 0,
                          "type": "number"
                        },
                        "warnings": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "overall",
                        "dimensions",
                        "nonEmpty",
                        "background",
                        "semantic",
                        "warnings"
                      ],
                      "type": "object"
                    },
                    "semantic": {
                      "additionalProperties": false,
                      "properties": {
                        "pass": {
                          "const": true,
                          "type": "boolean"
                        },
                        "repairInstructions": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        },
                        "summary": {
                          "maxLength": 20000,
                          "type": "string"
                        },
                        "violations": {
                          "items": {
                            "maxLength": 10000,
                            "type": "string"
                          },
                          "maxItems": 1000,
                          "type": "array"
                        }
                      },
                      "required": [
                        "pass",
                        "summary",
                        "violations",
                        "repairInstructions"
                      ],
                      "type": "object"
                    },
                    "tool": {
                      "const": "image_generation_review_candidate",
                      "type": "string"
                    },
                    "warnings": {
                      "items": {
                        "maxLength": 10000,
                        "type": "string"
                      },
                      "maxItems": 1000,
                      "type": "array"
                    }
                  },
                  "required": [
                    "tool",
                    "ok",
                    "reviewedArtifactPath",
                    "reviewedArtifactHash",
                    "reviewedAt",
                    "score",
                    "semantic",
                    "repairable",
                    "warnings"
                  ],
                  "type": "object"
                },
                "status": {
                  "enum": [
                    "candidate",
                    "accepted",
                    "rejected"
                  ],
                  "type": "string"
                },
                "summary": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 100000,
                  "type": "integer"
                }
              },
              "required": [
                "id",
                "status",
                "basedOnHash",
                "artifactPath",
                "artifactHash",
                "summary",
                "reviewEvidence",
                "createdAt"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "schemaVersion": {
            "const": 1,
            "type": "number"
          },
          "styleProfileRef": {
            "anyOf": [
              {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "truthLocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "maxLength": 20000,
                  "minLength": 1,
                  "type": "string"
                },
                "id": {
                  "maxLength": 120,
                  "minLength": 1,
                  "type": "string"
                },
                "nodeIds": {
                  "items": {
                    "maxLength": 120,
                    "minLength": 1,
                    "type": "string"
                  },
                  "maxItems": 10000,
                  "type": "array"
                },
                "sourceRef": {
                  "maxLength": 4096,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "id",
                "description",
                "nodeIds"
              ],
              "type": "object"
            },
            "maxItems": 10000,
            "type": "array"
          },
          "updatedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          }
        },
        "required": [
          "schemaVersion",
          "documentId",
          "canvas",
          "artifact",
          "nodes",
          "annotations",
          "truthLocks",
          "styleProfileRef",
          "revisions",
          "activeCandidateRevisionId",
          "acceptedRevisionId",
          "createdAt",
          "updatedAt"
        ],
        "type": "object"
      },
      "ok": {
        "const": true,
        "type": "boolean"
      },
      "status": {
        "const": "updated",
        "type": "string"
      }
    },
    "required": [
      "ok",
      "status",
      "document"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "visual-review",
    "image",
    "annotation"
  ],
  "title": "Update Visual Review context"
}
```

## `workspace-preview.annotations.delete`

Deletes one annotation thread through the canonical document annotation provider.

- Version: `2.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "pruneOrphanAnchors": {
        "default": true,
        "type": "boolean"
      },
      "threadId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "threadId",
      "pruneOrphanAnchors"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation",
    "edit"
  ],
  "title": "Delete an annotation thread"
}
```

## `workspace-preview.annotations.import`

Explicitly imports an annotation package into the canonical provider.

- Version: `2.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "attemptRelocation": {
        "type": "boolean"
      },
      "packageBase64": {
        "maxLength": 160000000,
        "minLength": 1,
        "type": "string"
      },
      "packagePath": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation",
    "migration"
  ],
  "title": "Import document annotations"
}
```

## `workspace-preview.annotations.list`

Returns annotations from the canonical provider for the open document.

- Version: `2.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation"
  ],
  "title": "List document annotations"
}
```

## `workspace-preview.annotations.resolve`

Changes thread resolution state through the canonical document annotation provider.

- Version: `2.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "resolved": {
        "type": "boolean"
      },
      "threadId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "threadId",
      "resolved"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation",
    "edit"
  ],
  "title": "Resolve or reopen an annotation thread"
}
```

## `workspace-preview.annotations.review.generate`

Generates review annotations after the caller confirms the editable review prompt.

- Version: `2.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "maxComments": {
        "exclusiveMinimum": 0,
        "maximum": 50,
        "type": "integer"
      },
      "prompt": {
        "maxLength": 20000,
        "minLength": 1,
        "type": "string"
      },
      "replaceExisting": {
        "type": "boolean"
      },
      "selection": {
        "additionalProperties": false,
        "properties": {
          "pageEnd": {
            "exclusiveMinimum": 0,
            "maximum": 1000000,
            "type": "integer"
          },
          "pageStart": {
            "exclusiveMinimum": 0,
            "maximum": 1000000,
            "type": "integer"
          },
          "rects": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "height": {
                  "exclusiveMinimum": 0,
                  "maximum": 1,
                  "type": "number"
                },
                "page": {
                  "exclusiveMinimum": 0,
                  "maximum": 1000000,
                  "type": "integer"
                },
                "width": {
                  "exclusiveMinimum": 0,
                  "maximum": 1,
                  "type": "number"
                },
                "x": {
                  "maximum": 1,
                  "minimum": 0,
                  "type": "number"
                },
                "y": {
                  "maximum": 1,
                  "minimum": 0,
                  "type": "number"
                }
              },
              "required": [
                "page",
                "x",
                "y",
                "width",
                "height"
              ],
              "type": "object"
            },
            "maxItems": 800,
            "minItems": 1,
            "type": "array"
          },
          "text": {
            "maxLength": 80000,
            "type": "string"
          }
        },
        "type": "object"
      }
    },
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation",
    "review"
  ],
  "title": "Generate document review annotations"
}
```

## `workspace-preview.annotations.review.improve`

Adds improvement guidance to an existing review annotation after confirmation.

- Version: `2.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "annotationId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "threadId": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "userComment": {
        "maxLength": 80000,
        "type": "string"
      }
    },
    "required": [
      "threadId"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation",
    "review"
  ],
  "title": "Improve a review annotation"
}
```

## `workspace-preview.annotations.update`

Creates or updates an annotation through the canonical document annotation provider.

- Version: `2.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "annotationId": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "annotationKind": {
        "enum": [
          "highlight",
          "comment",
          "note",
          "translation",
          "question",
          "answer"
        ],
        "type": "string"
      },
      "body": {
        "maxLength": 80000,
        "type": "string"
      },
      "target": {
        "additionalProperties": false,
        "properties": {
          "anchor": {
            "additionalProperties": false,
            "properties": {
              "contextAfter": {
                "maxLength": 2000,
                "type": "string"
              },
              "contextBefore": {
                "maxLength": 2000,
                "type": "string"
              },
              "id": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "kind": {
                "enum": [
                  "text",
                  "image",
                  "visual"
                ],
                "type": "string"
              },
              "pageEnd": {
                "exclusiveMinimum": 0,
                "maximum": 1000000,
                "type": "integer"
              },
              "pageStart": {
                "exclusiveMinimum": 0,
                "maximum": 1000000,
                "type": "integer"
              },
              "quote": {
                "maxLength": 80000,
                "type": "string"
              },
              "rects": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "height": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "page": {
                      "exclusiveMinimum": 0,
                      "maximum": 1000000,
                      "type": "integer"
                    },
                    "width": {
                      "exclusiveMinimum": 0,
                      "maximum": 1,
                      "type": "number"
                    },
                    "x": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    },
                    "y": {
                      "maximum": 1,
                      "minimum": 0,
                      "type": "number"
                    }
                  },
                  "required": [
                    "page",
                    "x",
                    "y",
                    "width",
                    "height"
                  ],
                  "type": "object"
                },
                "maxItems": 800,
                "type": "array"
              },
              "textRange": {
                "additionalProperties": false,
                "properties": {
                  "end": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "endColumn": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "endLine": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "start": {
                    "maximum": 9007199254740991,
                    "minimum": 0,
                    "type": "integer"
                  },
                  "startColumn": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  },
                  "startLine": {
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991,
                    "type": "integer"
                  }
                },
                "required": [
                  "start",
                  "end"
                ],
                "type": "object"
              }
            },
            "required": [
              "id"
            ],
            "type": "object"
          },
          "annotation": {
            "additionalProperties": false,
            "properties": {
              "authorId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "color": {
                "maxLength": 64,
                "type": "string"
              },
              "sourceMessageId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "sourceText": {
                "maxLength": 80000,
                "type": "string"
              },
              "targetLanguage": {
                "maxLength": 128,
                "type": "string"
              }
            },
            "type": "object"
          },
          "documentKind": {
            "enum": [
              "pdf",
              "docx",
              "markdown"
            ],
            "type": "string"
          },
          "thread": {
            "additionalProperties": false,
            "properties": {
              "authorId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "kind": {
                "enum": [
                  "highlight",
                  "comment",
                  "note",
                  "translation",
                  "question",
                  "answer"
                ],
                "type": "string"
              },
              "sourceMessageId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "sourceQuoteId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "status": {
                "enum": [
                  "open",
                  "resolved"
                ],
                "type": "string"
              },
              "title": {
                "maxLength": 512,
                "type": "string"
              }
            },
            "type": "object"
          },
          "threadId": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          }
        },
        "type": "object"
      }
    },
    "required": [
      "annotationId",
      "annotationKind",
      "body"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "annotation",
    "edit"
  ],
  "title": "Update a document annotation"
}
```

## `workspace-preview.apply-edit`

Applies one schema-validated edit using the canonical Workspace Preview host.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "definitions": {
      "__schema0": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "maxLength": 32000,
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "maxItems": 1000,
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "operation": {
        "oneOf": [
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "workspace.setSelection",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "selection": {
                "oneOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "const": "text",
                        "type": "string"
                      },
                      "ranges": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "endColumn": {
                              "maximum": 9007199254740991,
                              "minimum": 1,
                              "type": "integer"
                            },
                            "endLine": {
                              "maximum": 9007199254740991,
                              "minimum": 1,
                              "type": "integer"
                            },
                            "startColumn": {
                              "maximum": 9007199254740991,
                              "minimum": 1,
                              "type": "integer"
                            },
                            "startLine": {
                              "maximum": 9007199254740991,
                              "minimum": 1,
                              "type": "integer"
                            },
                            "text": {
                              "maxLength": 200000,
                              "type": "string"
                            }
                          },
                          "required": [
                            "startLine",
                            "startColumn",
                            "endLine",
                            "endColumn"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "minItems": 1,
                        "type": "array"
                      }
                    },
                    "required": [
                      "kind",
                      "ranges"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "cells": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "column": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "row": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "value": {}
                          },
                          "required": [
                            "row",
                            "column"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "tabular",
                        "type": "string"
                      },
                      "ranges": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "columnEnd": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "columnStart": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "rowEnd": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "rowStart": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            }
                          },
                          "required": [
                            "rowStart",
                            "rowEnd",
                            "columnStart",
                            "columnEnd"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "minItems": 1,
                        "type": "array"
                      },
                      "sheet": {
                        "maxLength": 256,
                        "type": "string"
                      }
                    },
                    "required": [
                      "kind",
                      "ranges"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "anchors": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "id": {
                              "maxLength": 256,
                              "minLength": 1,
                              "type": "string"
                            },
                            "page": {
                              "maximum": 9007199254740991,
                              "minimum": 1,
                              "type": "integer"
                            },
                            "paragraphIndex": {
                              "maximum": 9007199254740991,
                              "minimum": 1,
                              "type": "integer"
                            },
                            "quote": {
                              "maxLength": 200000,
                              "type": "string"
                            },
                            "rects": {
                              "items": {
                                "additionalProperties": false,
                                "properties": {
                                  "height": {
                                    "exclusiveMinimum": 0,
                                    "maximum": 1,
                                    "type": "number"
                                  },
                                  "page": {
                                    "exclusiveMinimum": 0,
                                    "maximum": 1000000,
                                    "type": "integer"
                                  },
                                  "width": {
                                    "exclusiveMinimum": 0,
                                    "maximum": 1,
                                    "type": "number"
                                  },
                                  "x": {
                                    "maximum": 1,
                                    "minimum": 0,
                                    "type": "number"
                                  },
                                  "y": {
                                    "maximum": 1,
                                    "minimum": 0,
                                    "type": "number"
                                  }
                                },
                                "required": [
                                  "page",
                                  "x",
                                  "y",
                                  "width",
                                  "height"
                                ],
                                "type": "object"
                              },
                              "maxItems": 800,
                              "type": "array"
                            }
                          },
                          "required": [
                            "id"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "minItems": 1,
                        "type": "array"
                      },
                      "kind": {
                        "const": "document",
                        "type": "string"
                      }
                    },
                    "required": [
                      "kind",
                      "anchors"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "elementIds": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "deck",
                        "type": "string"
                      },
                      "slideIds": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "minItems": 1,
                        "type": "array"
                      }
                    },
                    "required": [
                      "kind",
                      "slideIds"
                    ],
                    "type": "object"
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "data": {
                        "$ref": "#/definitions/__schema0"
                      },
                      "kind": {
                        "const": "domain",
                        "type": "string"
                      },
                      "selectionType": {
                        "maxLength": 128,
                        "minLength": 3,
                        "pattern": "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
                        "type": "string"
                      }
                    },
                    "required": [
                      "kind",
                      "selectionType",
                      "data"
                    ],
                    "type": "object"
                  }
                ]
              }
            },
            "required": [
              "kind",
              "path",
              "selection"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "text.replaceRange",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "range": {
                "additionalProperties": false,
                "properties": {
                  "end": {
                    "additionalProperties": false,
                    "properties": {
                      "column": {
                        "maximum": 9007199254740991,
                        "minimum": 1,
                        "type": "integer"
                      },
                      "line": {
                        "maximum": 9007199254740991,
                        "minimum": 1,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "line",
                      "column"
                    ],
                    "type": "object"
                  },
                  "start": {
                    "additionalProperties": false,
                    "properties": {
                      "column": {
                        "maximum": 9007199254740991,
                        "minimum": 1,
                        "type": "integer"
                      },
                      "line": {
                        "maximum": 9007199254740991,
                        "minimum": 1,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "line",
                      "column"
                    ],
                    "type": "object"
                  }
                },
                "required": [
                  "start",
                  "end"
                ],
                "type": "object"
              },
              "text": {
                "maxLength": 2000000,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "range",
              "text"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "column": {
                "maximum": 9007199254740991,
                "minimum": 0,
                "type": "integer"
              },
              "kind": {
                "const": "tabular.updateCell",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "row": {
                "maximum": 9007199254740991,
                "minimum": 0,
                "type": "integer"
              },
              "sheet": {
                "maxLength": 256,
                "type": "string"
              },
              "value": {}
            },
            "required": [
              "kind",
              "path",
              "row",
              "column",
              "value"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "afterRow": {
                "maximum": 9007199254740991,
                "minimum": -1,
                "type": "integer"
              },
              "kind": {
                "const": "tabular.insertRows",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "rows": {
                "items": {
                  "items": {},
                  "maxItems": 10000,
                  "type": "array"
                },
                "maxItems": 10000,
                "minItems": 1,
                "type": "array"
              },
              "sheet": {
                "maxLength": 256,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "afterRow",
              "rows"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "afterColumn": {
                "maximum": 9007199254740991,
                "minimum": -1,
                "type": "integer"
              },
              "columns": {
                "items": {
                  "items": {},
                  "maxItems": 10000,
                  "type": "array"
                },
                "maxItems": 10000,
                "minItems": 1,
                "type": "array"
              },
              "kind": {
                "const": "tabular.insertColumns",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "sheet": {
                "maxLength": 256,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "afterColumn",
              "columns"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "tabular.deleteRows",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "rows": {
                "items": {
                  "maximum": 9007199254740991,
                  "minimum": 0,
                  "type": "integer"
                },
                "maxItems": 10000,
                "minItems": 1,
                "type": "array"
              },
              "sheet": {
                "maxLength": 256,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "rows"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "columns": {
                "items": {
                  "maximum": 9007199254740991,
                  "minimum": 0,
                  "type": "integer"
                },
                "maxItems": 10000,
                "minItems": 1,
                "type": "array"
              },
              "kind": {
                "const": "tabular.deleteColumns",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "sheet": {
                "maxLength": 256,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "columns"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "elementId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "kind": {
                "const": "deck.updateTextElement",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "slideId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "text": {
                "maxLength": 2000,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "slideId",
              "elementId",
              "text"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "document.updateParagraph",
                "type": "string"
              },
              "paragraphIndex": {
                "maximum": 9007199254740991,
                "minimum": 1,
                "type": "integer"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "text": {
                "maxLength": 2000000,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "paragraphIndex",
              "text"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "data": {
                "$ref": "#/definitions/__schema0"
              },
              "kind": {
                "const": "domain.applyEdit",
                "type": "string"
              },
              "operationType": {
                "maxLength": 128,
                "minLength": 3,
                "pattern": "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "operationType",
              "data"
            ],
            "type": "object"
          }
        ]
      }
    },
    "required": [
      "operation"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "edit"
  ],
  "title": "Apply Workspace Preview edit"
}
```

## `workspace-preview.describe-asset`

Returns structured transport information for an open preview asset.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "asset"
  ],
  "title": "Describe Workspace Preview asset"
}
```

## `workspace-preview.export`

Exports the current preview through the canonical provider.

- Version: `1.0.0`
- Audiences: ui, agent
- Effect: `external-write`
- Approval: confirmation
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "target": {
        "additionalProperties": false,
        "properties": {
          "format": {
            "maxLength": 64,
            "minLength": 1,
            "type": "string"
          },
          "kind": {
            "enum": [
              "download",
              "workspace-file",
              "clipboard",
              "attachment"
            ],
            "type": "string"
          },
          "mimeType": {
            "maxLength": 128,
            "type": "string"
          },
          "path": {
            "maxLength": 4096,
            "type": "string"
          }
        },
        "required": [
          "kind",
          "format"
        ],
        "type": "object"
      }
    },
    "required": [
      "target"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "export"
  ],
  "title": "Export Workspace Preview"
}
```

## `workspace-preview.invoke-action`

Invokes an action advertised by the current Workspace Preview observation.

- Version: `1.0.0`
- Audiences: ui
- Effect: `workspace-write`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "optimistic"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "action": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "input": {
            "additionalProperties": {},
            "default": {},
            "propertyNames": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "type": "object"
          }
        },
        "required": [
          "actionId",
          "input"
        ],
        "type": "object"
      }
    },
    "required": [
      "action"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "action"
  ],
  "title": "Invoke Workspace Preview action"
}
```

## `workspace-preview.list`

Lists the canonical Workspace Preview providers registered in SciForge.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: global

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [],
  "tags": [
    "workspace",
    "preview",
    "discovery"
  ],
  "title": "List Workspace Preview plugins"
}
```

## `workspace-preview.open`

Opens a workspace file with the canonical Workspace Preview host and returns a scoped resource handle.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: workspace

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "anchor": {},
      "column": {
        "exclusiveMinimum": 0,
        "maximum": 1000000,
        "type": "integer"
      },
      "integrity": {},
      "line": {
        "exclusiveMinimum": 0,
        "maximum": 1000000,
        "type": "integer"
      },
      "mimeType": {
        "maxLength": 256,
        "minLength": 1,
        "type": "string"
      },
      "mode": {
        "enum": [
          "preview",
          "edit",
          "inspect"
        ],
        "type": "string"
      },
      "path": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "selection": {},
      "workspaceLocator": {
        "additionalProperties": false,
        "properties": {
          "contractVersion": {
            "const": 1,
            "type": "number"
          },
          "hostSessionId": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "path": {
            "maxLength": 4096,
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "contractVersion",
          "hostSessionId",
          "path"
        ],
        "type": "object"
      },
      "workspaceRoot": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "path",
      "workspaceRoot"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "producedResourceKinds": [
    "workspace-preview"
  ],
  "resourceKinds": [],
  "tags": [
    "workspace",
    "preview"
  ],
  "title": "Open Workspace Preview"
}
```

## `workspace-preview.prepare-artifact`

Prepares a bounded derived artifact using the canonical preview provider.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `compute`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "request": {
        "oneOf": [
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "cache-artifact",
                "type": "string"
              },
              "metadataKind": {
                "maxLength": 128,
                "minLength": 1,
                "type": "string"
              },
              "source": {
                "enum": [
                  "observation",
                  "plugin-metadata"
                ],
                "type": "string"
              }
            },
            "required": [
              "kind",
              "source"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "channelIndex": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              },
              "kind": {
                "const": "tile",
                "type": "string"
              },
              "level": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "t": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 100000,
                "type": "integer"
              },
              "x": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "y": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "z": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              }
            },
            "required": [
              "kind",
              "level",
              "x",
              "y",
              "width",
              "height"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "channelIndex": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "height": {
                "exclusiveMinimum": 0,
                "maximum": 4096,
                "type": "integer"
              },
              "kind": {
                "const": "thumbnail",
                "type": "string"
              },
              "t": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              },
              "width": {
                "exclusiveMinimum": 0,
                "maximum": 4096,
                "type": "integer"
              },
              "z": {
                "maximum": 1000000,
                "minimum": 0,
                "type": "integer"
              }
            },
            "required": [
              "kind",
              "width",
              "height"
            ],
            "type": "object"
          }
        ]
      }
    },
    "required": [
      "request"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "artifact"
  ],
  "title": "Prepare Workspace Preview artifact"
}
```

## `workspace-preview.read-artifact-range`

Reads a bounded byte range from a prepared preview artifact.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "request": {
        "additionalProperties": false,
        "properties": {
          "artifactId": {
            "maxLength": 256,
            "minLength": 1,
            "type": "string"
          },
          "range": {
            "additionalProperties": false,
            "properties": {
              "length": {
                "exclusiveMinimum": 0,
                "maximum": 52428800,
                "type": "integer"
              },
              "offset": {
                "maximum": 9007199254740991,
                "minimum": 0,
                "type": "integer"
              }
            },
            "required": [
              "offset",
              "length"
            ],
            "type": "object"
          }
        },
        "required": [
          "artifactId",
          "range"
        ],
        "type": "object"
      }
    },
    "required": [
      "request"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "artifact",
    "read"
  ],
  "title": "Read Workspace Preview artifact bytes"
}
```

## `workspace-preview.read-range`

Reads a bounded byte range from the current preview asset.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `read`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "none",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "range": {
        "additionalProperties": false,
        "properties": {
          "length": {
            "exclusiveMinimum": 0,
            "maximum": 52428800,
            "type": "integer"
          },
          "offset": {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          }
        },
        "required": [
          "offset",
          "length"
        ],
        "type": "object"
      }
    },
    "required": [
      "range"
    ],
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "read"
  ],
  "title": "Read Workspace Preview bytes"
}
```

## `workspace-preview.release`

Releases an open Workspace Preview session.

- Version: `1.0.0`
- Audiences: ui, agent, system
- Effect: `compute`
- Approval: none
- Scope: resource

### Contract

```json
{
  "concurrency": {
    "idempotency": "required",
    "revision": "none"
  },
  "contractVersion": 1,
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {},
    "type": "object"
  },
  "outputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "anyOf": [
      {
        "type": "null"
      },
      {
        "type": "boolean"
      },
      {
        "type": "number"
      },
      {
        "type": "string"
      },
      {
        "items": {
          "$ref": "#"
        },
        "type": "array"
      },
      {
        "additionalProperties": {
          "$ref": "#"
        },
        "propertyNames": {
          "type": "string"
        },
        "type": "object"
      }
    ]
  },
  "resourceKinds": [
    "workspace-preview"
  ],
  "tags": [
    "workspace",
    "preview",
    "lifecycle"
  ],
  "title": "Release Workspace Preview"
}
```

## Migrated domain boundaries

| Domain | Forbidden direct transport prefixes | Explicit UI-only transports |
| --- | --- | --- |
| Anchored Comments | anchoredComments: |  |
| Biology Room | biologyRoom: |  |
| Browser Preview | browserPreview: |  |
| Change Inspector |  |  |
| Controlled Process |  |  |
| Create Loop |  |  |
| Evidence DAG | evidenceDag: |  |
| Git Checkpoints |  |  |
| Paper Radar | paperRadar: |  |
| Project DAG | projectDag: |  |
| Remote SSH |  |  |
| Surface Context |  |  |
| Version Control |  |  |
| Visual Review | visual-document: |  |
| Workspace Preview | workspacePreview: |  |
