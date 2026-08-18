## ADDED Requirements

### Requirement: OpenContent Team root candidates use only safe display labels

When the Agent requests redacted Content Space root candidates for an OpenContent Provider Instance, the adapter SHALL reuse the canonical paginated personal/Team root mapping. A Team root SHALL contribute only its `shared` scope and Human-visible Team name to the Agent candidate output; the OpenContent Team ID, numeric folder ID, folder GUID, parent folder ID, DTO, endpoint, Token, Region URL, Region hash, and connection SHALL remain integration-private. The Provider Instance display label and Provider Kind SHALL NOT be substituted for a Team library label. Candidate output SHALL remain non-authorizing; confirmed root authorization SHALL independently re-enumerate the current bound account and accept only one exact canonical Team-name-and-scope match.

#### Scenario: Provider name is not a Team library name

- **WHEN** the Provider Instance is displayed as OpenContent and the Human has not supplied a Team library name
- **THEN** the Agent obtains Team `libraryLabel` candidates through the provider-neutral native read operation and does not submit `opencontent` or the Provider Instance display label as the root label

#### Scenario: OpenContent Team roots require more than one page

- **WHEN** `Team/GetMyTeamList` reports additional pages after the personal-root page or a Team page
- **THEN** Content Space preserves bounded opaque pagination until the Agent has obtained the relevant candidate labels without exposing any OpenContent root identity

#### Scenario: Canonical Team names are ambiguous

- **WHEN** two currently accessible Team roots have the same canonical Human-visible name and `shared` scope
- **THEN** the later confirmed authorization fails without choosing either Team, probing a raw folder identity, or issuing an Agent resource
