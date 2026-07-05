# WhatsApp Booking Automation (n8n)

Built this for a fitness studio client in Dubai. It runs their WhatsApp front desk — replies to leads, qualifies them (name, goal, experience, injuries, preferred time), books them straight into Google Calendar, and follows up automatically if they go quiet.

Leads also come in from Meta lead forms and Instagram, all funneled through the same flow.

**How it works:** message comes in → checked against existing leads in Google Sheets → an AI agent (Gemini) reads the context and the message, figures out what the lead needs (still deciding, ready to book, has questions, wants to reschedule/cancel, not interested), and replies accordingly. Depending on that, it either books/updates/cancels the calendar event, or logs it and follows up in 24h/48h if there's no response — and flags it for a manual call if it's still quiet after that.

**Stack:** n8n, WHAPI (WhatsApp API), Google Gemini, Google Sheets, Google Calendar.

Client's real spreadsheet/calendar IDs and business name are swapped for placeholders here, so you'd need to plug in your own to actually run it.

## How to use it

1. Import `workflow.json` into your n8n instance (Workflows → Import from File).
2. Set up accounts/credentials in n8n for: Google Sheets, Google Calendar, Google Gemini, and a WHAPI Bearer Token (WhatsApp API). Attach each one to the matching nodes.
3. Make a copy of the Google Sheet structure this expects — one "Leads" tab with columns for phone, name, email, goal, experience, injuries, booking status, calendar event ID. Replace the placeholder spreadsheet ID in the Sheets nodes with yours.
4. Create a Google Calendar for bookings and replace the placeholder calendar ID in the Calendar nodes with yours.
5. Grab the webhook URL from the "Webhook - WHAPI Inbound" node and point your WHAPI channel's incoming messages to it.
6. Update the system prompt in the AI Agent node with your own business info (services, hours, pricing).
7. Activate the workflow and send it a test WhatsApp message to confirm the flow end-to-end.

8. For guidance on how this workflow works, please refer to the video [Simulation Video](./Simulation_video_booking_automation.mp4)