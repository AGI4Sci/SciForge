---
status: accepted
---

# Package Shared Documents as a provider-neutral compile-time domain

Shared Documents V1 ships as one trusted compile-time domain package discovered through the standard manifest and generated composition path. It owns provider-neutral capability/reference contracts and a DocumentProvider SPI/catalog, while trusted integration packages contribute implementations through `main.document-provider-factory`; Shared Documents never imports those packages or a vendor Connector. Host and Agent Runtime see only generic SDK and Broker contracts. This preserves independent Provider replacement and a future isolated runtime extension path without a core feature map, vendor switch, or parallel tool path.
