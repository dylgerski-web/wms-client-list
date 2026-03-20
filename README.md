# Big Arena Fulfillment Client List

A futuristic black-and-yellow client integration tracker.

This app helps you:
- Add clients with contact details and integration type
- Define integration parts and step-by-step implementation stages
- Track each client's current stage and overall status
- Monitor all clients with search, status filters, and KPI cards
- Share a clean landing page with integration information and lifecycle steps

## Features

- Landing page with integration process overview
- Client creation form with custom parts and steps
- Pipeline cards with live progress percentages
- Detailed client view to:
	- Update overall client status
	- Update per-part status
	- Check off step completion
	- Add new parts and steps at any time
- Local persistence via browser localStorage
- Optional demo data loader

## Run

Because this is a static app, you can run it with any simple web server.

Example using Python:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Pages:
- `http://localhost:8080` - Landing page
- `http://localhost:8080/admin.html` - Admin tracker page

## Files

- `admin.html` - Admin dashboard for client management and status tracking
- `index.html` - Landing page with integration information and lifecycle steps
- `styles.css` - Futuristic black/yellow theme and responsive design
- `app.js` - State management, rendering, filters, and local storage logic