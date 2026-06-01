export interface SuccessResponse {
  title: string
  output: string
  metadata?: Record<string, unknown>
}

export interface ErrorResponse {
  error: string
}

export type ToolResponse = SuccessResponse | string

export function successResponse(
  title: string,
  output: string,
  metadata?: Record<string, unknown>
): SuccessResponse {
  return { title, output, ...(metadata ? { metadata } : {}) }
}

export function errorResponse(message: string): string {
  return `Error: ${message}`
}
