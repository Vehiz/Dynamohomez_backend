# DynamoHomez Backend API

Base URL (local): `http://localhost:4000/api`

## Response Envelope

Successful responses return:

```json
{
  "success": true,
  "data": {}
}
```

Error responses generally return:

```json
{
  "success": false,
  "error": "Human readable message"
}
```

## Auth Header

For protected client operations, send:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

---

## Health

### `GET /health`
Checks API + dependency health.

Example response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "services": {
      "database": "up",
      "redis": "up"
    },
    "uptimeMs": 12
  }
}
```

---

## Auth

### `POST /auth/register`
Body:
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "StrongPass123",
  "role": "tenant"
}
```

Example response:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "a4f7dff7-6f34-4c25-86bc-1d7db59cd1e3",
      "email": "john@example.com",
      "name": "John Doe",
      "role": "tenant",
      "roles": ["tenant"]
    },
    "tokens": {
      "accessToken": "...",
      "refreshToken": "...",
      "accessTokenExpiresIn": "15m",
      "refreshTokenExpiresIn": "30d"
    }
  }
}
```

### `POST /auth/login`
Body:
```json
{
  "email": "john@example.com",
  "password": "StrongPass123"
}
```

### `POST /auth/refresh`
Body:
```json
{
  "refreshToken": "..."
}
```

Example response `data`:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "accessTokenExpiresIn": "15m",
  "refreshTokenExpiresIn": "30d"
}
```

### `POST /auth/logout`
Body:
```json
{
  "refreshToken": "..."
}
```

Example response:

```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

### `POST /auth/forgot-password`
Body:
```json
{
  "email": "john@example.com"
}
```

Example response (dev flow):

```json
{
  "success": true,
  "data": {
    "resetToken": "..."
  }
}
```

### `POST /auth/reset-password`
Body:
```json
{
  "resetToken": "...",
  "password": "NewStrongPass123"
}
```

### `POST /auth/oauth/google/start`
Body:
```json
{
  "redirectTo": "http://localhost:5173/auth/callback"
}
```

Current status: placeholder route for migration phase.

---

## Listings

### `GET /listings`
Query (optional): `type`, `city`, `minPrice`, `maxPrice`, `bedrooms`

Example:

`GET /listings?city=Lagos&type=rent&minPrice=100000`

### `GET /listings/:id`

Example:

`GET /listings/listing-1`

### `POST /listings`
Body: partial listing object (missing values are defaulted by backend).

Minimal example body:

```json
{
  "title": "Mini flat in Yaba",
  "type": "rent",
  "price": 650000,
  "priceType": "yearly",
  "location": {
    "state": "Lagos",
    "city": "Lagos",
    "area": "Yaba",
    "address": "Herbert Macaulay"
  }
}
```

### `PUT /listings/:id`
Body: partial listing object.

### `DELETE /listings/:id`

Returns:

```json
{
  "success": true,
  "data": null
}
```

---

## Profiles

### `GET /profiles`
Query (optional): `gender`, `minAge`, `maxAge`, `minBudget`, `maxBudget`, `location`

### `GET /profiles/:id`

### `POST /profiles`
Body: profile object.

Minimal example:

```json
{
  "id": "user-123",
  "name": "Mary Okon",
  "age": 27,
  "gender": "female",
  "occupation": "professional",
  "role": "tenant",
  "roles": ["tenant"],
  "preferences": {
    "budget": { "min": 300000, "max": 800000 },
    "location": ["Yaba", "Surulere"],
    "genderPreference": "any",
    "ageRange": { "min": 24, "max": 35 },
    "moveInDate": "2026-03-20",
    "lifestyle": ["quiet"],
    "cleanliness": 4,
    "socialLevel": 3,
    "petsAllowed": false,
    "smokingAllowed": false
  }
}
```

### `PUT /profiles/:id`
Body: partial profile object.

---

## Requests

### `GET /requests/:userId`
Returns both sent and received requests.

### `POST /requests`
Body:
```json
{
  "fromUserId": "...",
  "toUserId": "...",
  "type": "roommate",
  "message": "optional"
}
```

### `PUT /requests/:id`
Body:
```json
{
  "status": "accepted"
}
```

Allowed: `accepted`, `rejected`.

### `GET /roommate-requests/received/:userId`
Legacy compatibility route returning snake_case fields.

Example item:

```json
{
  "id": "...",
  "from_user_id": "...",
  "to_user_id": "...",
  "status": "pending",
  "created_at": "2026-03-02T12:00:00.000Z"
}
```

---

## Saved Listings & Users

### `GET /users/:userId/saved`
### `POST /users/:userId/saved/:listingId`
### `DELETE /users/:userId/saved/:listingId`

Saved endpoints return `string[]` of listing IDs.

### `DELETE /users/:userId`

---

## Engagement

### Verification
- `GET /verification/:userId`
- `POST /verification/email`
- `POST /verification/phone/request`
- `POST /verification/phone/confirm`
- `POST /verification/id`

`POST /verification/phone/request` returns a development OTP in payload.

### Reviews
- `GET /reviews/:targetType/:targetId`
- `POST /reviews`
- `POST /reviews/:reviewId/helpful`

`POST /reviews` example body:

```json
{
  "targetType": "user",
  "targetId": "user-2",
  "reviewerId": "user-1",
  "reviewerName": "John",
  "reviewerAvatar": "",
  "rating": 5,
  "title": "Great experience",
  "comment": "Very responsive and respectful",
  "verified": true
}
```

### Reports
- `POST /reports`
- `GET /reports/:listingId`

`POST /reports` example body:

```json
{
  "listingId": "listing-1",
  "reporterId": "user-1",
  "reason": "outdated",
  "description": "This listing is no longer available"
}
```

### Notification Events
- `POST /notifications/request-sent`
- `POST /notifications/request-accepted`

These currently enqueue/stub notification events in backend storage.

---

## Platform Stats

### `GET /stats`
Returns:
```json
{
  "properties": 0,
  "users": 0,
  "partners": 0,
  "cities": 0
}
```

---

## Notes

- API is currently compatibility-focused for frontend migration.
- Some features (e.g., Google OAuth exchange and real external mail delivery) are intentionally stubbed during transition.
- Data persistence requires configured PostgreSQL and Redis in `backend/.env`.
