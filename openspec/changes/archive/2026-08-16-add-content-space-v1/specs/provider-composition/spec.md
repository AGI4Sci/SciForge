## MODIFIED Requirements

### Requirement: Provider Instances use a trusted non-secret directory

Selectable instances SHALL be trusted `main.provider-instance-directory-entry` extensions with exact declaration/runtime location, version, owner, opaque ProviderInstanceRef, Provider Kind, and safe display name. Entries SHALL contain no endpoint, credential, Token, Provider Connection, or resource identity. Duplicate/mismatched entries SHALL fail before factory use.

#### Scenario: Integration package adds a selectable instance

- **WHEN** a trusted package contributes a compatible Content Space factory and directory entry
- **THEN** source and packaged generated composition SHALL expose it without a Host map, Provider switch, implicit default, or domain import of that integration

#### Scenario: Duplicate Provider Instance is declared

- **WHEN** two contributions claim one ProviderInstanceRef
- **THEN** composition SHALL fail before either Provider factory is invoked
