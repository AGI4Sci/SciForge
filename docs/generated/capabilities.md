# SciForge capability reference

<!-- GENERATED FILE. DO NOT EDIT. Run `npm run capability:generate`. -->

Authoritative source: `src/main/modules/index.ts`

Registered actions: **95**

| Action ID | Version | Audiences | Effect | Approval | Scope |
| --- | --- | --- | --- | --- | --- |
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
| `dataset-api.catalog` | 1.0.0 | ui, agent, system | read | none | workspace |
| `dataset-api.deduplicate` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.execute-plan` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.filter` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.graph-organize` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.id-map` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.id-map-provider` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.join` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.list` | 1.0.0 | ui, agent, system | read | none | workspace |
| `dataset-api.metadata` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.prepare-plan` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.profile` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.publish` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.raw-data` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.register` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.register-provider` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.resume-plan` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.select-columns` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.structure-profile` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.structure-validate` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.transform` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `dataset-api.validate` | 1.0.0 | ui, agent, system | workspace-write | none | workspace |
| `evidence-dag.priority` | 1.0.0 | ui, agent | compute | none | global |
| `evidence-dag.resolve-evidence-preview` | 1.0.0 | ui, agent | read | none | global |
| `evidence-dag.update` | 1.0.0 | ui, agent | compute | none | global |
| `evidence-dag.view` | 1.0.0 | ui, agent, system | read | none | global |
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
| `remote-ssh.virtualbox-machines.list` | 1.0.0 | ui | read | none | global |
| `surface.current` | 2.0.0 | ui, agent, system | read | none | global |
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

## `dataset-api.catalog`

Lists built-in public biology data providers, transports, metadata access, raw-data access, and adapter requirements.

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
      "category": {
        "enum": [
          "core",
          "drug-and-small-molecule",
          "pathway-and-network",
          "structure-and-single-cell"
        ],
        "type": "string"
      },
      "query": {
        "maxLength": 160,
        "minLength": 1,
        "type": "string"
      },
      "transport": {
        "enum": [
          "rest",
          "graphql",
          "rest-and-graphql",
          "sdk-object-store"
        ],
        "type": "string"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-access"
  ],
  "title": "Browse biology dataset providers"
}
```

## `dataset-api.deduplicate`

Deduplicates records by explicit structured keys and preserves removed duplicates separately.

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
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "keep": {
        "enum": [
          "first",
          "last"
        ],
        "type": "string"
      },
      "keys": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "minItems": 1,
        "type": "array"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "inputArtifact",
      "planId",
      "keys",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Deduplicate a dataset"
}
```

## `dataset-api.execute-plan`

Executes every operation in a confirmed plan with durable step checkpoints.

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
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      }
    },
    "required": [
      "planId"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Execute a confirmed dataset plan"
}
```

## `dataset-api.filter`

Applies structured filter conditions and writes deterministic included and excluded artifacts.

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
      "combine": {
        "enum": [
          "all",
          "any"
        ],
        "type": "string"
      },
      "conditions": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "caseSensitive": {
              "type": "boolean"
            },
            "field": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            },
            "operator": {
              "enum": [
                "equals",
                "not_equals",
                "contains",
                "starts_with",
                "ends_with",
                "in",
                "not_in",
                "gt",
                "gte",
                "lt",
                "lte",
                "between",
                "exists"
              ],
              "type": "string"
            },
            "value": {}
          },
          "required": [
            "field",
            "operator"
          ],
          "type": "object"
        },
        "maxItems": 100,
        "minItems": 1,
        "type": "array"
      },
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "inputArtifact",
      "planId",
      "conditions",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Filter a dataset artifact"
}
```

## `dataset-api.graph-organize`

Converts explicit edge records into deterministic node, edge, graph-summary, and invalid-record artifacts.

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
      "deduplicateEdges": {
        "type": "boolean"
      },
      "directed": {
        "type": "boolean"
      },
      "edgeTypeField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "graphType": {
        "enum": [
          "pathway",
          "network"
        ],
        "type": "string"
      },
      "includeFields": {
        "items": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 100,
        "type": "array"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "maxOutputEdges": {
        "maximum": 5000000,
        "minimum": 1,
        "type": "integer"
      },
      "onInvalid": {
        "enum": [
          "drop",
          "fail"
        ],
        "type": "string"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      },
      "sourceField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "targetField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "weightField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "inputArtifact",
      "planId",
      "graphType",
      "sourceField",
      "targetField",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Organize pathway or network data"
}
```

## `dataset-api.id-map`

Maps identifiers using a workspace mapping artifact with explicit cardinality and unmatched policies.

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
      "cardinality": {
        "enum": [
          "first",
          "all",
          "explode"
        ],
        "type": "string"
      },
      "caseSensitive": {
        "type": "boolean"
      },
      "deduplicateTargets": {
        "type": "boolean"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "inputField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "inputFormat": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputRecordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      },
      "mappingArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "mappingFormat": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv"
        ],
        "type": "string"
      },
      "mappingFromField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "mappingRecordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      },
      "mappingToField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "maxOutputRecords": {
        "maximum": 5000000,
        "minimum": 1,
        "type": "integer"
      },
      "onUnmapped": {
        "enum": [
          "keep",
          "null",
          "drop",
          "fail"
        ],
        "type": "string"
      },
      "outputField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "outputFormat": {
        "enum": [
          "json",
          "jsonl",
          "csv",
          "tsv"
        ],
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      }
    },
    "required": [
      "planId",
      "inputArtifact",
      "mappingArtifact",
      "inputField",
      "mappingFromField",
      "mappingToField",
      "outputField",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Map biomedical identifiers"
}
```

## `dataset-api.id-map-provider`

Runs a bounded UniProt mapping job, persists provenance, and applies the mapping deterministically.

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
      "cardinality": {
        "enum": [
          "first",
          "all",
          "explode"
        ],
        "type": "string"
      },
      "caseSensitive": {
        "type": "boolean"
      },
      "deduplicateTargets": {
        "type": "boolean"
      },
      "fromDatabase": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_.:/-]+$",
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "inputField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "inputFormat": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputRecordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "maxIds": {
        "maximum": 100000,
        "minimum": 1,
        "type": "integer"
      },
      "maxOutputRecords": {
        "maximum": 5000000,
        "minimum": 1,
        "type": "integer"
      },
      "maxPollAttempts": {
        "maximum": 300,
        "minimum": 1,
        "type": "integer"
      },
      "maxRetries": {
        "maximum": 3,
        "minimum": 0,
        "type": "integer"
      },
      "onUnmapped": {
        "enum": [
          "keep",
          "null",
          "drop",
          "fail"
        ],
        "type": "string"
      },
      "outputField": {
        "maxLength": 512,
        "minLength": 1,
        "type": "string"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "outputFormat": {
        "enum": [
          "json",
          "jsonl",
          "csv",
          "tsv"
        ],
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "pollIntervalMs": {
        "maximum": 10000,
        "minimum": 100,
        "type": "integer"
      },
      "provider": {
        "const": "uniprot",
        "type": "string"
      },
      "taxId": {
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991,
        "type": "integer"
      },
      "timeoutMs": {
        "maximum": 120000,
        "minimum": 1000,
        "type": "integer"
      },
      "toDatabase": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_.:/-]+$",
        "type": "string"
      }
    },
    "required": [
      "planId",
      "inputArtifact",
      "inputField",
      "provider",
      "fromDatabase",
      "toDatabase",
      "outputField",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "id-mapping",
    "network"
  ],
  "title": "Map biomedical identifiers with UniProt"
}
```

## `dataset-api.join`

Joins two structured artifacts with explicit key mappings and deterministic unmatched outputs.

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
      "joinType": {
        "enum": [
          "inner",
          "left",
          "right",
          "full"
        ],
        "type": "string"
      },
      "keys": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "left": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            },
            "right": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            }
          },
          "required": [
            "left",
            "right"
          ],
          "type": "object"
        },
        "maxItems": 50,
        "minItems": 1,
        "type": "array"
      },
      "leftArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "leftFormat": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv"
        ],
        "type": "string"
      },
      "leftRecordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "maxOutputRecords": {
        "maximum": 5000000,
        "minimum": 1,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "outputFormat": {
        "enum": [
          "json",
          "jsonl",
          "csv",
          "tsv"
        ],
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "rightArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "rightFormat": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv"
        ],
        "type": "string"
      },
      "rightPrefix": {
        "maxLength": 64,
        "minLength": 1,
        "pattern": "^[A-Za-z_][A-Za-z0-9_.-]*$",
        "type": "string"
      },
      "rightRecordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "planId",
      "leftArtifact",
      "rightArtifact",
      "keys",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Join dataset artifacts"
}
```

## `dataset-api.list`

Lists API-backed dataset databases registered in the caller workspace.

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
    "definitions": {
      "__schema0": {
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-access"
  ],
  "title": "List registered dataset databases"
}
```

## `dataset-api.metadata`

Reads structured metadata from a registered dataset database and can persist the complete response as a checksummed artifact.

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
      "maxBytes": {
        "maximum": 10485760,
        "minimum": 1024,
        "type": "integer"
      },
      "maxRetries": {
        "maximum": 3,
        "minimum": 0,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "pathParameters": {
        "additionalProperties": {
          "maxLength": 1024,
          "minLength": 1,
          "type": "string"
        },
        "propertyNames": {
          "maxLength": 128,
          "minLength": 1,
          "pattern": "^[A-Za-z][A-Za-z0-9_]*$",
          "type": "string"
        },
        "type": "object"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "query": {
        "additionalProperties": {
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
                  }
                ]
              },
              "maxItems": 100,
              "type": "array"
            }
          ]
        },
        "propertyNames": {
          "maxLength": 256,
          "minLength": 1,
          "type": "string"
        },
        "type": "object"
      },
      "responseMode": {
        "enum": [
          "auto",
          "summary",
          "full"
        ],
        "type": "string"
      },
      "sourceId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "timeoutMs": {
        "maximum": 60000,
        "minimum": 100,
        "type": "integer"
      }
    },
    "required": [
      "sourceId"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "metadata",
    "network"
  ],
  "title": "Read dataset metadata"
}
```

## `dataset-api.prepare-plan`

Creates a reviewable data-preparation plan or confirms an immutable draft after user agreement.

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
      "confirmationNotes": {
        "items": {
          "maxLength": 1000,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 100,
        "type": "array"
      },
      "confirmedByUser": {
        "type": "boolean"
      },
      "draftPlanId": {
        "pattern": "^plan-[a-f0-9]{16}$",
        "type": "string"
      },
      "exclusions": {
        "items": {
          "maxLength": 1000,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 100,
        "type": "array"
      },
      "objective": {
        "maxLength": 8000,
        "minLength": 1,
        "type": "string"
      },
      "operations": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "description": {
              "maxLength": 1000,
              "minLength": 1,
              "type": "string"
            },
            "parameters": {
              "additionalProperties": {},
              "propertyNames": {
                "type": "string"
              },
              "type": "object"
            },
            "tool": {
              "enum": [
                "dataset_api_metadata",
                "dataset_api_raw_data",
                "dataset_profile",
                "dataset_filter",
                "dataset_select_columns",
                "dataset_transform",
                "dataset_deduplicate",
                "dataset_id_map",
                "dataset_id_map_provider",
                "dataset_join",
                "dataset_structure_profile",
                "dataset_structure_validate",
                "dataset_graph_organize",
                "dataset_validate",
                "dataset_publish"
              ],
              "type": "string"
            }
          },
          "required": [
            "tool",
            "description"
          ],
          "type": "object"
        },
        "maxItems": 100,
        "minItems": 1,
        "type": "array"
      },
      "outputs": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "description": {
              "maxLength": 1000,
              "minLength": 1,
              "type": "string"
            },
            "format": {
              "enum": [
                "json",
                "jsonl",
                "csv",
                "tsv",
                "fasta"
              ],
              "type": "string"
            },
            "name": {
              "maxLength": 255,
              "minLength": 1,
              "type": "string"
            }
          },
          "required": [
            "name",
            "format"
          ],
          "type": "object"
        },
        "maxItems": 20,
        "minItems": 1,
        "type": "array"
      },
      "sources": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "metadataRequest": {
              "additionalProperties": {},
              "propertyNames": {
                "type": "string"
              },
              "type": "object"
            },
            "providerId": {
              "maxLength": 80,
              "minLength": 1,
              "type": "string"
            },
            "purpose": {
              "maxLength": 1000,
              "minLength": 1,
              "type": "string"
            },
            "rawDataRequest": {
              "additionalProperties": {},
              "propertyNames": {
                "type": "string"
              },
              "type": "object"
            }
          },
          "required": [
            "providerId",
            "purpose"
          ],
          "type": "object"
        },
        "maxItems": 50,
        "type": "array"
      }
    },
    "required": [
      "confirmedByUser"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Prepare a dataset processing plan"
}
```

## `dataset-api.profile`

Profiles JSON, JSONL, CSV, TSV, or FASTA data and persists a bounded report.

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
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "inputArtifact"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Profile a dataset artifact"
}
```

## `dataset-api.publish`

Publishes confirmed-plan artifacts with manifest, schema, quality report, checksums, and provenance.

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
      "allowInvalid": {
        "type": "boolean"
      },
      "artifacts": {
        "items": {
          "maxLength": 4096,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 100,
        "minItems": 1,
        "type": "array"
      },
      "description": {
        "maxLength": 4000,
        "type": "string"
      },
      "name": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "outputDirectoryName": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "requireValidation": {
        "type": "boolean"
      }
    },
    "required": [
      "planId",
      "name",
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Publish a prepared dataset"
}
```

## `dataset-api.raw-data`

Downloads validated raw data from a registered database into a checksummed workspace artifact.

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
      "expectedFormat": {
        "enum": [
          "auto",
          "fasta",
          "json",
          "text",
          "binary"
        ],
        "type": "string"
      },
      "maxBytes": {
        "maximum": 1073741824,
        "minimum": 1024,
        "type": "integer"
      },
      "maxRetries": {
        "maximum": 3,
        "minimum": 0,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "overwrite": {
        "type": "boolean"
      },
      "pathParameters": {
        "additionalProperties": {
          "maxLength": 1024,
          "minLength": 1,
          "type": "string"
        },
        "propertyNames": {
          "maxLength": 128,
          "minLength": 1,
          "pattern": "^[A-Za-z][A-Za-z0-9_]*$",
          "type": "string"
        },
        "type": "object"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "query": {
        "additionalProperties": {
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
                  }
                ]
              },
              "maxItems": 100,
              "type": "array"
            }
          ]
        },
        "propertyNames": {
          "maxLength": 256,
          "minLength": 1,
          "type": "string"
        },
        "type": "object"
      },
      "range": {
        "additionalProperties": false,
        "properties": {
          "end": {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          },
          "start": {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          }
        },
        "required": [
          "start"
        ],
        "type": "object"
      },
      "sourceId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "timeoutMs": {
        "maximum": 600000,
        "minimum": 100,
        "type": "integer"
      }
    },
    "required": [
      "sourceId"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "raw-data",
    "network"
  ],
  "title": "Download dataset raw data"
}
```

## `dataset-api.register`

Registers an API-backed database with separate metadata and raw-data endpoint templates.

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
      "auth": {
        "additionalProperties": false,
        "properties": {
          "envVar": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[A-Za-z_][A-Za-z0-9_]*$",
            "type": "string"
          },
          "headerName": {
            "maxLength": 128,
            "minLength": 1,
            "pattern": "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$",
            "type": "string"
          },
          "queryName": {
            "maxLength": 128,
            "minLength": 1,
            "type": "string"
          },
          "required": {
            "type": "boolean"
          },
          "type": {
            "enum": [
              "bearer",
              "header",
              "query"
            ],
            "type": "string"
          }
        },
        "required": [
          "type",
          "envVar"
        ],
        "type": "object"
      },
      "baseUrl": {
        "format": "uri",
        "maxLength": 4096,
        "type": "string"
      },
      "defaultHeaders": {
        "additionalProperties": {
          "maxLength": 4096,
          "type": "string"
        },
        "propertyNames": {
          "maxLength": 128,
          "minLength": 1,
          "pattern": "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$",
          "type": "string"
        },
        "type": "object"
      },
      "description": {
        "maxLength": 2000,
        "type": "string"
      },
      "id": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "metadataEndpoint": {
        "maxLength": 2048,
        "minLength": 1,
        "type": "string"
      },
      "name": {
        "maxLength": 160,
        "minLength": 1,
        "type": "string"
      },
      "overwrite": {
        "type": "boolean"
      },
      "rawDataEndpoint": {
        "maxLength": 2048,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "id",
      "baseUrl",
      "metadataEndpoint",
      "rawDataEndpoint"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Register a dataset database"
}
```

## `dataset-api.register-provider`

Registers an executable built-in biology provider preset in the caller workspace.

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
      "overwrite": {
        "type": "boolean"
      },
      "providerId": {
        "enum": [
          "ncbi-eutils",
          "ensembl",
          "uniprot",
          "ucsc-genome-browser",
          "pubchem-pug-rest",
          "clinicaltrials-gov",
          "kegg",
          "reactome",
          "quickgo",
          "string",
          "alphafold-db"
        ],
        "type": "string"
      },
      "sourceId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      }
    },
    "required": [
      "providerId"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Register a built-in dataset provider"
}
```

## `dataset-api.resume-plan`

Resumes a failed or interrupted confirmed plan from its checksum-verified checkpoint.

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
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "runId": {
        "pattern": "^run-[a-f0-9]{16}$",
        "type": "string"
      }
    },
    "required": [
      "planId"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Resume a dataset plan"
}
```

## `dataset-api.select-columns`

Selects, renames, defaults, and requires structured fields without arbitrary code.

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
      "columns": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "defaultValue": {},
            "required": {
              "type": "boolean"
            },
            "source": {
              "maxLength": 512,
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
            "source"
          ],
          "type": "object"
        },
        "maxItems": 500,
        "minItems": 1,
        "type": "array"
      },
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "outputFormat": {
        "enum": [
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "inputArtifact",
      "planId",
      "columns",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Select and rename dataset fields"
}
```

## `dataset-api.structure-profile`

Profiles SDF or mmCIF structure data with format-aware parsers.

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
      "format": {
        "enum": [
          "auto",
          "sdf",
          "mmcif"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      }
    },
    "required": [
      "inputArtifact"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Profile structure data"
}
```

## `dataset-api.structure-validate`

Validates SDF or mmCIF records and persists a quality report.

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
      "failOnInvalid": {
        "type": "boolean"
      },
      "format": {
        "enum": [
          "auto",
          "sdf",
          "mmcif"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "minRecords": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "requireCoordinates": {
        "type": "boolean"
      }
    },
    "required": [
      "inputArtifact"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Validate structure data"
}
```

## `dataset-api.transform`

Applies allow-listed deterministic normalization and scalar transformations.

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
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "operations": {
        "items": {
          "oneOf": [
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "operation": {
                  "const": "trim",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "operation",
                "field"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "operation": {
                  "const": "lowercase",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "operation",
                "field"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "operation": {
                  "const": "uppercase",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "operation",
                "field"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "operation": {
                  "const": "normalize_whitespace",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "operation",
                "field"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "onError": {
                  "enum": [
                    "fail",
                    "null",
                    "keep"
                  ],
                  "type": "string"
                },
                "operation": {
                  "const": "to_number",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "operation",
                "field"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "falseValues": {
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
                  "maxItems": 50,
                  "minItems": 1,
                  "type": "array"
                },
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "onError": {
                  "enum": [
                    "fail",
                    "null",
                    "keep"
                  ],
                  "type": "string"
                },
                "operation": {
                  "const": "to_boolean",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "trueValues": {
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
                  "maxItems": 50,
                  "minItems": 1,
                  "type": "array"
                }
              },
              "required": [
                "operation",
                "field"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "operation": {
                  "const": "replace_literal",
                  "type": "string"
                },
                "replaceAll": {
                  "type": "boolean"
                },
                "replacement": {
                  "maxLength": 4096,
                  "type": "string"
                },
                "search": {
                  "maxLength": 1024,
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
                "operation",
                "field",
                "search",
                "replacement"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "caseSensitive": {
                  "type": "boolean"
                },
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "mappings": {
                  "items": {
                    "additionalProperties": false,
                    "properties": {
                      "from": {
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
                      "to": {
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
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "type": "object"
                  },
                  "maxItems": 1000,
                  "minItems": 1,
                  "type": "array"
                },
                "onUnmapped": {
                  "enum": [
                    "keep",
                    "null",
                    "fail"
                  ],
                  "type": "string"
                },
                "operation": {
                  "const": "map_values",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                }
              },
              "required": [
                "operation",
                "field",
                "mappings"
              ],
              "type": "object"
            },
            {
              "additionalProperties": false,
              "properties": {
                "field": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "operation": {
                  "const": "set_default",
                  "type": "string"
                },
                "target": {
                  "maxLength": 512,
                  "minLength": 1,
                  "type": "string"
                },
                "value": {
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
                }
              },
              "required": [
                "operation",
                "field",
                "value"
              ],
              "type": "object"
            }
          ]
        },
        "maxItems": 500,
        "minItems": 1,
        "type": "array"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "outputFormat": {
        "enum": [
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "inputArtifact",
      "planId",
      "operations",
      "outputFileName"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Transform dataset fields"
}
```

## `dataset-api.validate`

Validates schema, record, range, uniqueness, missingness, and FASTA integrity constraints.

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
      "failOnInvalid": {
        "type": "boolean"
      },
      "format": {
        "enum": [
          "auto",
          "json",
          "jsonl",
          "csv",
          "tsv",
          "fasta"
        ],
        "type": "string"
      },
      "inputArtifact": {
        "maxLength": 4096,
        "minLength": 1,
        "type": "string"
      },
      "maxBytes": {
        "maximum": 268435456,
        "minimum": 1024,
        "type": "integer"
      },
      "maxMissingFraction": {
        "maximum": 1,
        "minimum": 0,
        "type": "number"
      },
      "minRecords": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "outputFileName": {
        "maxLength": 255,
        "minLength": 1,
        "type": "string"
      },
      "planId": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "type": "string"
      },
      "recordPath": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string"
      },
      "rules": {
        "default": [],
        "items": {
          "additionalProperties": false,
          "properties": {
            "allowedValues": {
              "items": {
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
                  }
                ]
              },
              "maxItems": 1000,
              "type": "array"
            },
            "field": {
              "maxLength": 512,
              "minLength": 1,
              "type": "string"
            },
            "max": {
              "type": "number"
            },
            "min": {
              "type": "number"
            },
            "required": {
              "type": "boolean"
            },
            "type": {
              "enum": [
                "string",
                "number",
                "boolean",
                "object",
                "array"
              ],
              "type": "string"
            },
            "unique": {
              "type": "boolean"
            }
          },
          "required": [
            "field"
          ],
          "type": "object"
        },
        "maxItems": 500,
        "type": "array"
      }
    },
    "required": [
      "inputArtifact",
      "rules"
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
      "datasetApi": {
        "additionalProperties": false,
        "properties": {
          "actionId": {
            "enum": [
              "dataset-api.catalog",
              "dataset-api.register-provider",
              "dataset-api.list",
              "dataset-api.register",
              "dataset-api.metadata",
              "dataset-api.raw-data",
              "dataset-api.prepare-plan",
              "dataset-api.execute-plan",
              "dataset-api.resume-plan",
              "dataset-api.profile",
              "dataset-api.filter",
              "dataset-api.select-columns",
              "dataset-api.transform",
              "dataset-api.deduplicate",
              "dataset-api.id-map",
              "dataset-api.id-map-provider",
              "dataset-api.join",
              "dataset-api.structure-profile",
              "dataset-api.structure-validate",
              "dataset-api.graph-organize",
              "dataset-api.validate",
              "dataset-api.publish"
            ],
            "type": "string"
          },
          "result": {
            "$ref": "#/definitions/__schema0"
          },
          "success": {
            "const": true,
            "type": "boolean"
          }
        },
        "required": [
          "actionId",
          "success",
          "result"
        ],
        "type": "object"
      }
    },
    "required": [
      "datasetApi"
    ],
    "type": "object"
  },
  "resourceKinds": [],
  "tags": [
    "dataset",
    "biology",
    "data-preparation"
  ],
  "title": "Validate a dataset artifact"
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
| Biology Room | biologyRoom: |  |
| Browser Preview | browserPreview: |  |
| Dataset API |  |  |
| Evidence DAG | evidenceDag: |  |
| Paper Radar | paperRadar: |  |
| Project DAG | projectDag: |  |
| Remote SSH |  |  |
| Surface Context |  |  |
| Workspace Preview | workspacePreview: |  |
