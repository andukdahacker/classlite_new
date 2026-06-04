// Package handler — auth handler for story 1.4.
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// maxAuthRequestBodyBytes caps every auth endpoint body to 16 KiB. The handful
// of fields these endpoints accept fit in far less, so any payload approaching
// this limit is either malformed or hostile. Cap exists to prevent unbounded
// io.ReadAll / json.Decode allocation from OOMing the process.
const maxAuthRequestBodyBytes = 16 * 1024

// AuthHandler wraps AuthService for HTTP routing.
type AuthHandler struct {
	Svc *service.AuthService
}

// decodeAuthBody applies the shared 16 KiB body cap and decodes JSON into dst.
// A nil error means the body parsed cleanly; any error is mapped to a 422
// ValidationError by the caller (oversize bodies, malformed JSON, and read
// errors all collapse to the same user-facing response).
func decodeAuthBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxAuthRequestBodyBytes)
	return json.NewDecoder(r.Body).Decode(dst)
}

// Request DTOs — camelCase JSON tags per architecture format convention.
type registerRequestBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"fullName"`
}

type verifyEmailRequestBody struct {
	Token string `json:"token"`
}

type resendVerificationRequestBody struct {
	Email string `json:"email"`
}

// Response DTOs — GO-5: never use omitempty.
type registerResponseUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	FullName      string `json:"fullName"`
	EmailVerified bool   `json:"emailVerified"`
}

type registerResponseBody struct {
	User          registerResponseUser `json:"user"`
	VerifyPollID  string               `json:"verifyPollId"`
	EmailDelivery string               `json:"emailDelivery"`
}

type verifyEmailResponseBody struct {
	Verified bool   `json:"verified"`
	Email    string `json:"email"`
}

type resendResponseBody struct {
	// Pointer so JSON encodes null when there is no pollId (ambiguous response, AC7).
	VerifyPollID *string `json:"verifyPollId"`
}

type verifyStatusResponseBody struct {
	Verified bool   `json:"verified"`
	Email    string `json:"email"`
}

// Register implements POST /api/auth/register (AC1, AC2, AC11, AC12).
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) error {
	var req registerRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	res, err := h.Svc.Register(r.Context(), service.RegisterRequest{
		Email:    req.Email,
		Password: req.Password,
		FullName: req.FullName,
	})
	if err != nil {
		return err
	}

	WriteJSON(w, http.StatusCreated, registerResponseBody{
		User: registerResponseUser{
			ID:            uuid.UUID(res.User.ID.Bytes).String(),
			Email:         res.User.Email,
			FullName:      res.User.FullName,
			EmailVerified: res.User.EmailVerified,
		},
		VerifyPollID:  res.VerifyPollID.String(),
		EmailDelivery: res.EmailDelivery,
	})
	return nil
}

// VerifyEmail implements POST /api/auth/verify-email (AC3, AC4, AC5, AC6).
func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	var req verifyEmailRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	res, err := h.Svc.VerifyEmail(r.Context(), req.Token)
	if err != nil {
		return err
	}

	WriteJSON(w, http.StatusOK, verifyEmailResponseBody{
		Verified: res.Verified,
		Email:    res.Email,
	})
	return nil
}

// ResendVerification implements POST /api/auth/resend-verification (AC7, H4).
func (h *AuthHandler) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	var req resendVerificationRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	res, err := h.Svc.ResendVerification(r.Context(), req.Email)
	if err != nil {
		return err
	}

	body := resendResponseBody{}
	if res.VerifyPollID != nil {
		s := res.VerifyPollID.String()
		body.VerifyPollID = &s
	}
	WriteJSON(w, http.StatusOK, body)
	return nil
}

// VerifyStatus implements GET /api/auth/verify-status?pollId=<uuid> (AC8).
func (h *AuthHandler) VerifyStatus(w http.ResponseWriter, r *http.Request) error {
	raw := r.URL.Query().Get("pollId")
	if raw == "" {
		return model.NotFoundError{Resource: "verify_poll", Code: "POLL_ID_NOT_FOUND"}
	}
	pollID, err := uuid.Parse(raw)
	if err != nil {
		// Malformed UUID — same 404 as unknown, per AC8 second clause.
		return model.NotFoundError{Resource: "verify_poll", Code: "POLL_ID_NOT_FOUND"}
	}

	res, err := h.Svc.VerifyStatus(r.Context(), pollID)
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, verifyStatusResponseBody{
		Verified: res.Verified,
		Email:    res.Email,
	})
	return nil
}
