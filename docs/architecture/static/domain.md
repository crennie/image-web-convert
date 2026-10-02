# Domain Model

**Scope:** concepts in the active conversion workflow. See [data](data.md) for persistence ownership.

```mermaid
classDiagram
    direction LR
    class Session {
      expiry
      bearer access
      effective limits
    }
    class ConversionOperation {
      immutable request intent
      output format
      status and revision
    }
    class FileSlot {
      client identity
      declared size
      state
    }
    class AcceptedInput {
      bytes and fingerprint
    }
    class CompletedOutput {
      format and metadata
      downloadable image
    }
    Session "1" --> "0..1" ConversionOperation : owns
    ConversionOperation "1" --> "1..*" FileSlot : defines in manifest order
    FileSlot "1" --> "0..1" AcceptedInput : accepts
    FileSlot "1" --> "0..1" CompletedOutput : commits
```

A session is short lived and owns at most one active-style conversion operation. The operation fixes the file manifest and output intent; its slots receive server-assigned IDs. A slot can accept one input and reaches a completed, failed, or cancelled outcome. Completed outputs remain available even if another slot fails or cancellation is requested. A matching operation-creation retry reuses the existing operation; changed intent conflicts.
