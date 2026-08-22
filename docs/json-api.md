# JSON API

JavaScript clients can post JSON instead of a plain form. CORS is pinned to the exact origin you registered, and preflight is handled.

## Posting

```js
const response = await fetch("https://forms.shibumistack.dev/f/<public-id>", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "person@example.com", topics: ["one", "two"] }),
});
// 202 { "ok": true } on success
```

Values must be strings or arrays of strings. The same field limits apply as for HTML posts.

## Responses

| Status | Meaning |
| --- | --- |
| `202` | Stored. Body is `{ "ok": true }`. |
| `400` | Invalid field name, value, nesting, or too many fields. |
| `403` | Origin missing or not your registered origin. |
| `404` | Unknown or disabled endpoint. |
| `413` | Request body over 64 KiB. |
| `415` | Unsupported content type. |
| `429` | Rate limited or the form's inbox is full. |

## Origin rules

JSON posts require an `Origin` header matching your registered page origin exactly. Plain HTML posts work without one because the browser sends the visitor back to your page instead of reading a response.
