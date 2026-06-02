export class MesaError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = "MesaError"
    this.code = code
  }
}

export class PhaseError extends MesaError {
  constructor(message: string) {
    super(message, "INVALID_PHASE")
    this.name = "PhaseError"
  }
}

export class StateError extends MesaError {
  constructor(message: string, code: string = "STATE_ERROR") {
    super(message, code)
    this.name = "StateError"
  }
}

export class ValidationError extends MesaError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR")
    this.name = "ValidationError"
  }
}

export class CatalogError extends MesaError {
  constructor(message: string) {
    super(message, "CATALOG_ERROR")
    this.name = "CatalogError"
  }
}

export class UpdaterError extends MesaError {
  constructor(message: string, code: string = "UPDATER_ERROR") {
    super(message, code)
    this.name = "UpdaterError"
  }
}
