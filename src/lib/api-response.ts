import { NextResponse } from "next/server";

/**
 * Standardized API response helpers.
 * All API routes should use these for consistent response format.
 */

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(error: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { success: false, error, ...(details ? { details } : {}) },
    { status }
  );
}

export function apiNotFound(message = "Resource not found") {
  return apiError(message, 404);
}

export function apiUnauthorized(message = "Unauthorized") {
  return apiError(message, 401);
}

export function apiServerError(message = "Internal server error", details?: unknown) {
  return apiError(message, 500, details);
}
