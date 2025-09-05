export type ApiErrorToken = {
    type: "invalid_token";
    message?: string;
}

export type ApiErrorSessionNotFound = {
    type: "session_not_found";
    message?: string;
}

export type ApiErrorSessionExpired = {
    type: "session_expired";
    message?: string;
}

export type ApiUploadsErrorSessionUsed = {
    type: "session_used";
    message?: string;
}

export type ApiUploadsErrorMissingFiles = {
    type: "missing_files";
    message?: string;
}

export type ApiUploadsErrorFiles = {
    type: "upload_error";
    message?: string;
}

export type ApiError =
    | ApiErrorToken
    | ApiErrorSessionNotFound
    | ApiErrorSessionExpired
    | ApiUploadsErrorSessionUsed
    | ApiUploadsErrorMissingFiles
    | ApiUploadsErrorFiles;
