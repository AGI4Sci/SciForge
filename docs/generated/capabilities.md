# SciForge capability reference

<!-- GENERATED FILE. DO NOT EDIT. Run `npm run capability:generate`. -->

Authoritative source: `src/main/modules/index.ts`

Registered actions: **56**

| Action ID | Version | Audiences | Effect | Approval | Scope |
| --- | --- | --- | --- | --- | --- |
| `artifact.inspect` | 2.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.apply` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `biology-room.create` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `biology-room.history` | 1.0.0 | ui, agent, system | read | none | resource |
| `biology-room.list` | 1.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.load` | 1.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.open` | 1.0.0 | ui, agent, system | read | none | workspace |
| `biology-room.open-or-create` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `biology-room.refresh` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
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
| `remote-ssh.bindings.get` | 1.0.0 | ui | read | none | workspace |
| `remote-ssh.bindings.save` | 1.0.0 | ui | external-write | confirmation | workspace |
| `remote-ssh.command.cancel` | 1.0.0 | ui, agent | external-write | confirmation | workspace |
| `remote-ssh.command.execute` | 1.0.0 | ui, agent | destructive | confirmation | resource |
| `remote-ssh.file.download` | 1.0.0 | ui, agent | workspace-write | confirmation | resource |
| `remote-ssh.file.upload` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `remote-ssh.lab-environment.console.open` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.lab-environment.ensure` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.lab-environment.get` | 1.0.0 | ui | read | none | global |
| `remote-ssh.lab-environment.stop` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.labs.delete` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.labs.list` | 1.0.0 | ui | read | none | global |
| `remote-ssh.labs.save` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.target.delete` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.target.probe` | 1.0.0 | ui, agent, system | read | none | resource |
| `remote-ssh.target.save` | 1.0.0 | ui | external-write | confirmation | global |
| `remote-ssh.targets.catalog` | 1.0.0 | ui | read | none | global |
| `remote-ssh.targets.list` | 1.0.0 | ui, agent, system | read | none | workspace |
| `surface.current` | 2.0.0 | ui, agent, system | read | none | global |
| `surface.inspect` | 2.0.0 | ui, agent, system | read | none | resource |
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

## `artifact.inspect`

Visually inspects workspace-confined PNG, JPEG, or WebP artifacts through the Model Router.

- Version: `2.0.0`
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
      "artifacts": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "id": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "path": {
              "maxLength": 4096,
              "minLength": 1,
              "type": "string"
            },
            "regions": {
              "items": {
                "additionalProperties": false,
                "properties": {
                  "height": {
                    "exclusiveMinimum": 0,
                    "maximum": 1,
                    "type": "number"
                  },
                  "id": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  },
                  "label": {
                    "maxLength": 512,
                    "minLength": 1,
                    "type": "string"
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
                  "id",
                  "x",
                  "y",
                  "width",
                  "height"
                ],
                "type": "object"
              },
              "maxItems": 64,
              "type": "array"
            }
          },
          "required": [
            "id",
            "path"
          ],
          "type": "object"
        },
        "maxItems": 8,
        "minItems": 1,
        "type": "array"
      },
      "outputIntent": {
        "additionalProperties": false,
        "properties": {
          "instructions": {
            "maxLength": 4000,
            "minLength": 1,
            "type": "string"
          },
          "kind": {
            "enum": [
              "description",
              "ocr",
              "comparison",
              "quality-review",
              "structured-extraction",
              "custom"
            ],
            "type": "string"
          }
        },
        "required": [
          "kind"
        ],
        "type": "object"
      },
      "task": {
        "maxLength": 16000,
        "minLength": 1,
        "type": "string"
      },
      "truthLocks": {
        "items": {
          "maxLength": 1000,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 64,
        "type": "array"
      }
    },
    "required": [
      "task",
      "artifacts"
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
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "artifacts": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "artifactRef": {
              "pattern": "^artifact_[A-Za-z0-9_-]{20,}$",
              "type": "string"
            },
            "id": {
              "maxLength": 128,
              "minLength": 1,
              "type": "string"
            },
            "mimeType": {
              "enum": [
                "image/png",
                "image/jpeg",
                "image/webp"
              ],
              "type": "string"
            },
            "sha256": {
              "pattern": "^[a-f0-9]{64}$",
              "type": "string"
            },
            "size": {
              "exclusiveMinimum": 0,
              "maximum": 9007199254740991,
              "type": "integer"
            }
          },
          "required": [
            "id",
            "artifactRef",
            "mimeType",
            "size",
            "sha256"
          ],
          "type": "object"
        },
        "maxItems": 8,
        "minItems": 1,
        "type": "array"
      },
      "evidence": {
        "$ref": "#/definitions/__schema0"
      }
    },
    "required": [
      "artifacts",
      "evidence"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "artifact",
    "visual",
    "inspection"
  ],
  "title": "Inspect workspace image artifacts"
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

## `surface.inspect`

Captures and visually inspects the latest visible surface or an opaque target reference.

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
    "properties": {
      "outputIntent": {
        "additionalProperties": false,
        "properties": {
          "instructions": {
            "maxLength": 8000,
            "minLength": 1,
            "type": "string"
          },
          "kind": {
            "enum": [
              "description",
              "ocr",
              "comparison",
              "quality-review",
              "structured-extraction",
              "custom"
            ],
            "type": "string"
          }
        },
        "required": [
          "kind"
        ],
        "type": "object"
      },
      "targetRef": {
        "pattern": "^target_[A-Za-z0-9_-]{20,}$",
        "type": "string"
      },
      "task": {
        "maxLength": 16000,
        "minLength": 1,
        "type": "string"
      },
      "truthLocks": {
        "items": {
          "maxLength": 4000,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 64,
        "type": "array"
      }
    },
    "required": [
      "task"
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
            "type": "string"
          },
          {
            "items": {
              "$ref": "#/definitions/__schema0"
            },
            "type": "array"
          },
          {
            "additionalProperties": {
              "$ref": "#/definitions/__schema0"
            },
            "propertyNames": {
              "type": "string"
            },
            "type": "object"
          }
        ]
      }
    },
    "properties": {
      "artifact": {
        "additionalProperties": false,
        "properties": {
          "artifactRef": {
            "pattern": "^artifact_[A-Za-z0-9_-]{20,}$",
            "type": "string"
          },
          "capturedAt": {
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
            "type": "string"
          },
          "height": {
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "type": "integer"
          },
          "mimeType": {
            "const": "image/png",
            "type": "string"
          },
          "targetRef": {
            "pattern": "^target_[A-Za-z0-9_-]{20,}$",
            "type": "string"
          },
          "width": {
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "type": "integer"
          }
        },
        "required": [
          "artifactRef",
          "mimeType",
          "capturedAt",
          "width",
          "height"
        ],
        "type": "object"
      },
      "evidence": {
        "$ref": "#/definitions/__schema0"
      }
    },
    "required": [
      "artifact",
      "evidence"
    ],
    "type": "object"
  },
  "resourceKinds": [
    "surface"
  ],
  "tags": [
    "surface",
    "visual",
    "inspection"
  ],
  "title": "Inspect visible SciForge surface"
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
| Artifact Inspection |  |  |
| Biology Room | biologyRoom: |  |
| Paper Radar | paperRadar: |  |
| Remote SSH |  |  |
| Surface Inspection |  |  |
| Workspace Preview | workspacePreview: |  |
