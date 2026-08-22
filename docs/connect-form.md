# Connect your form

Register your page URL and email on the [home page](/), confirm the sign-in link, and you get a submission endpoint like `https://forms.shibumistack.dev/f/<public-id>`.

## The snippet

Point any HTML form at your endpoint:

```html
<form action="https://forms.shibumistack.dev/f/<public-id>" method="post">
  <label>
    Email
    <input type="email" name="email" required>
  </label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Notify me</button>
</form>
```

Every submitted field needs a `name` attribute. After a post, visitors return to your registered page.

## The honeypot

The hidden `website` field is a spam trap: invisible to people, tempting to bots. Submissions that fill it are accepted with a normal response but never stored. Keep the field name exactly as shown in your dashboard snippet.

## What the endpoint accepts

- Content types: `application/x-www-form-urlencoded`, `multipart/form-data` (text fields only), and JSON from your registered origin.
- Up to 64 named fields per submission; names up to 100 characters, values up to 10 KiB, 20 repeats per name, 64 KiB per request.
- Files, nested JSON objects, and unknown content types are rejected.
- Submissions render as inert text in the dashboard. Nothing posted can execute there.

## After submissions arrive

The dashboard shows a paginated table with dynamic columns, full detail per submission, private notes, CSV export, and permanent deletion. You can disable an endpoint at any time without losing stored data.
