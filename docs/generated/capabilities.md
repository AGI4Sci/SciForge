# SciForge capability reference

<!-- GENERATED FILE. DO NOT EDIT. Run `npm run capability:generate`. -->

Authoritative source: `src/main/capabilities/app-registry.ts`

Registered actions: **18**

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
| `workspace-preview.apply-edit` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
| `workspace-preview.describe-asset` | 1.0.0 | ui, agent, system | read | none | resource |
| `workspace-preview.export` | 1.0.0 | ui, agent | external-write | confirmation | resource |
| `workspace-preview.invoke-action` | 1.0.0 | ui, agent, system | workspace-write | none | resource |
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
      "roomId"
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
    "biology",
    "room"
  ],
  "title": "Open Biology Room resource"
}
```

## `biology-room.open-or-create`

Opens the room for a workspace biology asset, creating it through the canonical service when needed.

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
    "biology",
    "room",
    "open"
  ],
  "title": "Open or create Biology Room"
}
```

## `biology-room.refresh`

Refreshes source-backed assets in the current Biology Room through the canonical service.

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
                      "atoms": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "element": {
                              "maxLength": 8,
                              "type": "string"
                            },
                            "id": {
                              "maxLength": 128,
                              "type": "string"
                            },
                            "index": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            }
                          },
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "chains": {
                        "items": {
                          "maxLength": 64,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "molecular",
                        "type": "string"
                      },
                      "ligands": {
                        "items": {
                          "maxLength": 64,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "residues": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "chain": {
                              "maxLength": 64,
                              "type": "string"
                            },
                            "index": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "insertionCode": {
                              "maxLength": 8,
                              "type": "string"
                            },
                            "name": {
                              "maxLength": 32,
                              "type": "string"
                            }
                          },
                          "required": [
                            "index"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
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
                      "features": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "end": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "id": {
                              "maxLength": 256,
                              "minLength": 1,
                              "type": "string"
                            },
                            "start": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "type": {
                              "maxLength": 128,
                              "minLength": 1,
                              "type": "string"
                            }
                          },
                          "required": [
                            "type",
                            "start",
                            "end"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "sequence",
                        "type": "string"
                      },
                      "ranges": {
                        "items": {
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
                            },
                            "strand": {
                              "enum": [
                                "+",
                                "-"
                              ],
                              "type": "string"
                            }
                          },
                          "required": [
                            "start",
                            "end"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "minItems": 1,
                        "type": "array"
                      },
                      "sequenceId": {
                        "maxLength": 256,
                        "minLength": 1,
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
                      "embeddings": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "omics",
                        "type": "string"
                      },
                      "matrixIds": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "obsKeys": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "ranges": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "axis": {
                              "enum": [
                                "obs",
                                "var",
                                "row",
                                "column"
                              ],
                              "type": "string"
                            },
                            "axisLength": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "clipped": {
                              "type": "boolean"
                            },
                            "end": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "matrixId": {
                              "maxLength": 256,
                              "minLength": 1,
                              "type": "string"
                            },
                            "matrixName": {
                              "maxLength": 256,
                              "type": "string"
                            },
                            "start": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            }
                          },
                          "required": [
                            "matrixId",
                            "axis",
                            "start",
                            "end"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "varKeys": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
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
                      "channels": {
                        "items": {
                          "maxLength": 128,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "bioimaging",
                        "type": "string"
                      },
                      "regions": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "type": "number"
                            },
                            "t": {
                              "minimum": 0,
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
                            },
                            "z": {
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
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "roiIds": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
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
                        "const": "spectra",
                        "type": "string"
                      },
                      "peaks": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "intensity": {
                              "type": "number"
                            },
                            "label": {
                              "maxLength": 128,
                              "type": "string"
                            },
                            "mz": {
                              "type": "number"
                            }
                          },
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "ranges": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "xEnd": {
                              "type": "number"
                            },
                            "xStart": {
                              "type": "number"
                            },
                            "yEnd": {
                              "type": "number"
                            },
                            "yStart": {
                              "type": "number"
                            }
                          },
                          "required": [
                            "xStart",
                            "xEnd"
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
              "kind": {
                "const": "annotation.upsert",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
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
                      "docx"
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
              "kind",
              "path",
              "annotationId",
              "annotationKind",
              "body"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "annotation.thread.update",
                "type": "string"
              },
              "patch": {
                "additionalProperties": false,
                "properties": {
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
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
              "threadId": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "kind",
              "path",
              "threadId",
              "patch"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "annotation.thread.delete",
                "type": "string"
              },
              "path": {
                "maxLength": 4096,
                "minLength": 1,
                "type": "string"
              },
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
              "kind",
              "path",
              "threadId",
              "pruneOrphanAnchors"
            ],
            "type": "object"
          },
          {
            "additionalProperties": false,
            "properties": {
              "kind": {
                "const": "molecular.setSelection",
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
                      "atoms": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "element": {
                              "maxLength": 8,
                              "type": "string"
                            },
                            "id": {
                              "maxLength": 128,
                              "type": "string"
                            },
                            "index": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            }
                          },
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "chains": {
                        "items": {
                          "maxLength": 64,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "molecular",
                        "type": "string"
                      },
                      "ligands": {
                        "items": {
                          "maxLength": 64,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "residues": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "chain": {
                              "maxLength": 64,
                              "type": "string"
                            },
                            "index": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "insertionCode": {
                              "maxLength": 8,
                              "type": "string"
                            },
                            "name": {
                              "maxLength": 32,
                              "type": "string"
                            }
                          },
                          "required": [
                            "index"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
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
                      "features": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "end": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "id": {
                              "maxLength": 256,
                              "minLength": 1,
                              "type": "string"
                            },
                            "start": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "type": {
                              "maxLength": 128,
                              "minLength": 1,
                              "type": "string"
                            }
                          },
                          "required": [
                            "type",
                            "start",
                            "end"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "sequence",
                        "type": "string"
                      },
                      "ranges": {
                        "items": {
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
                            },
                            "strand": {
                              "enum": [
                                "+",
                                "-"
                              ],
                              "type": "string"
                            }
                          },
                          "required": [
                            "start",
                            "end"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "minItems": 1,
                        "type": "array"
                      },
                      "sequenceId": {
                        "maxLength": 256,
                        "minLength": 1,
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
                      "embeddings": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "omics",
                        "type": "string"
                      },
                      "matrixIds": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "obsKeys": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "ranges": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "axis": {
                              "enum": [
                                "obs",
                                "var",
                                "row",
                                "column"
                              ],
                              "type": "string"
                            },
                            "axisLength": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "clipped": {
                              "type": "boolean"
                            },
                            "end": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            },
                            "matrixId": {
                              "maxLength": 256,
                              "minLength": 1,
                              "type": "string"
                            },
                            "matrixName": {
                              "maxLength": 256,
                              "type": "string"
                            },
                            "start": {
                              "maximum": 9007199254740991,
                              "minimum": 0,
                              "type": "integer"
                            }
                          },
                          "required": [
                            "matrixId",
                            "axis",
                            "start",
                            "end"
                          ],
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "varKeys": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
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
                      "channels": {
                        "items": {
                          "maxLength": 128,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "kind": {
                        "const": "bioimaging",
                        "type": "string"
                      },
                      "regions": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "height": {
                              "exclusiveMinimum": 0,
                              "type": "number"
                            },
                            "t": {
                              "minimum": 0,
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
                            },
                            "z": {
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
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "roiIds": {
                        "items": {
                          "maxLength": 256,
                          "minLength": 1,
                          "type": "string"
                        },
                        "maxItems": 10000,
                        "type": "array"
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
                        "const": "spectra",
                        "type": "string"
                      },
                      "peaks": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "intensity": {
                              "type": "number"
                            },
                            "label": {
                              "maxLength": 128,
                              "type": "string"
                            },
                            "mz": {
                              "type": "number"
                            }
                          },
                          "type": "object"
                        },
                        "maxItems": 10000,
                        "type": "array"
                      },
                      "ranges": {
                        "items": {
                          "additionalProperties": false,
                          "properties": {
                            "xEnd": {
                              "type": "number"
                            },
                            "xStart": {
                              "type": "number"
                            },
                            "yEnd": {
                              "type": "number"
                            },
                            "yStart": {
                              "type": "number"
                            }
                          },
                          "required": [
                            "xStart",
                            "xEnd"
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
| Biology Room | biologyRoom: | biologyRoom:pick-file |
| Workspace Preview | workspacePreview: |  |
