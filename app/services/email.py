# app/services/email.py
#
# Handles all email sending for the Zuno platform.
#
# WHY EMAIL VERIFICATION MATTERS:
# 1. Confirms the email address actually belongs to the user
# 2. Gives us a reliable channel for important notifications
# 3. Required for password reset functionality
# 4. Builds trust — users know Zuno can reach them
#
# HOW THE VERIFICATION LINK WORKS:
# We generate a long random token e.g:
# "a3f9k2p8x7q1b4d8c2e5f6a3f9k2p8x7"
# We save it in the database linked to the user's email.
# We send the user a link containing that token:
# https://zuno.co.ke/verify-email?token=a3f9k2p8x7q1b4d8...
# When they click it, we find the token in our database,
# confirm it belongs to their account, and mark email verified.
# The token is then deleted — it can never be used again.

from flask import current_app
from flask_mail import Message
from app import mail, mysql
import secrets
import os
import threading
import requests
from datetime import datetime, timedelta


def _send_via_brevo(to_email, to_name, subject, html_content, text_content=None):
    """Sends a transactional email using Brevo's HTTP API (v3/smtp/email)."""
    api_key = os.getenv('BREVO_API_KEY')
    if not api_key:
        return False
    sender_email = os.getenv('BREVO_SENDER_EMAIL') or os.getenv('MAIL_DEFAULT_SENDER') or 'escrowzuno@gmail.com'
    sender_name = os.getenv('BREVO_SENDER_NAME', 'Zuno Escrow')
    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": to_email, "name": to_name or to_email}],
        "subject": subject,
        "htmlContent": html_content,
    }
    if text_content:
        payload["textContent"] = text_content

    def _post():
        try:
            resp = requests.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={
                    "accept": "application/json",
                    "api-key": api_key,
                    "content-type": "application/json",
                },
                json=payload,
                timeout=10,
            )
            if resp.status_code in (200, 201, 202):
                print(f"[BREVO EMAIL] Sent '{subject}' to {to_email}")
            else:
                print(f"[BREVO EMAIL ERROR] ({resp.status_code}) to {to_email}: {resp.text}")
        except Exception as exc:
            print(f"[BREVO EMAIL ERROR] Failed to send to {to_email}: {exc}")

    threading.Thread(target=_post, daemon=True).start()
    return True


def send_otp_email(email, full_name, otp_code):
    """Sends the 6-digit OTP code to the user's email address via Brevo (or SMTP fallback)."""
    if not email:
        return False
    subject = f"{otp_code} is your Zuno verification code"
    text_body = (
        f"Hello {full_name or 'there'},\n\n"
        f"Your Zuno verification code is: {otp_code}\n\n"
        f"This code is valid for 10 minutes. Never share this code with anyone.\n\n"
        f"The Zuno Team"
    )
    html_body = f"""
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #1a1a2e; padding: 20px; border-radius: 8px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0;">ZUNO</h1>
        <p style="color: #a0a0b0; margin: 5px 0;">Secure Escrow Platform</p>
    </div>
    <div style="padding: 30px 0; text-align: center;">
        <h2 style="color: #1a1a2e;">Hello {full_name or 'there'},</h2>
        <p style="color: #444; font-size: 16px; line-height: 1.6;">
            Use the 6-digit verification code below to verify your Zuno account:
        </p>
        <div style="margin: 28px auto; padding: 18px 28px; display: inline-block; background-color: #f4f3ff; border: 2px dashed #4f46e5; border-radius: 12px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">
            {otp_code}
        </div>
        <p style="color: #666; font-size: 14px;">
            Valid for <strong>10 minutes</strong>. Never share this code with anyone.
        </p>
    </div>
</body>
</html>
    """
    if os.getenv('BREVO_API_KEY'):
        return _send_via_brevo(email, full_name, subject, html_body, text_body)
    if not os.getenv('MAIL_USERNAME') or not os.getenv('MAIL_PASSWORD'):
        print(f"[OTP EMAIL DEV - not sent] To {email}: code is {otp_code}")
        return True
    try:
        msg = Message(subject=subject, recipients=[email], body=text_body, html=html_body)
        app = current_app._get_current_object()
        def _send_async(app_obj, message):
            with app_obj.app_context():
                try:
                    mail.send(message)
                except Exception as exc:
                    print(f"[EMAIL ERROR] OTP email failed for {email}: {exc}")
        threading.Thread(target=_send_async, args=(app, msg), daemon=True).start()
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] OTP email failed for {email}: {e}")
        return False


def generate_verification_token():
    """
    Generates a cryptographically secure random token.
    
    secrets.token_urlsafe() generates a URL-safe random string.
    We use 32 bytes which gives us a 43-character token.
    The probability of two identical tokens is astronomically low —
    roughly 1 in 2^256. Effectively impossible to guess.
    
    Example output: "a3F9k2P8x7Q1b4D8c2E5f6G7h8I9j0K1L2M3n4O5"
    """
    return secrets.token_urlsafe(32)


def send_verification_email(user_id, email, full_name):
    """
    Generates a verification token and sends it to the user's email.
    
    Called automatically when:
    - A new user registers with an email address
    - A user updates their email address
    - A user requests a new verification email
    
    Args:
        user_id   : the user's database ID
        email     : the email address to verify
        full_name : used to personalize the email greeting
    
    Returns:
        True  if email was sent successfully
        False if sending failed
    """
    # Generate a unique token for this verification
    token = generate_verification_token()
    
    # Token expires in 24 hours
    expires_at = datetime.now() + timedelta(hours=24)
    
    cursor = mysql.connection.cursor()
    
    # Save token to database
    # If a verification record already exists for this user,
    # replace it with the new one (handles resend case)
    cursor.execute("""
        INSERT INTO email_verifications
            (user_id, email, token, expires_at)
        VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            token = %s,
            email = %s,
            expires_at = %s,
            verified_at = NULL
    """, (
        user_id, email, token, expires_at,
        token, email, expires_at
    ))
    mysql.connection.commit()
    cursor.close()
    
    # Build the verification link
    # In development: http://localhost:3000/verify-email?token=xxx
    # In production:  https://zuno.co.ke/verify-email?token=xxx
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000')
    verification_link = f"{frontend_url}/verify-email?token={token}"
    
    # Build and send the email
    subject = "Verify your Zuno email address"
    text_body = f"""
Hello {full_name},

Welcome to Zuno! Please verify your email address by clicking the link below:

{verification_link}

This link expires in 24 hours.

If you did not create a Zuno account, please ignore this email.

The Zuno Team
support@zuno.co.ke
    """
    html_body = f"""
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    
    <div style="background-color: #1a1a2e; padding: 20px; border-radius: 8px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0;">ZUNO</h1>
        <p style="color: #a0a0b0; margin: 5px 0;">Secure Escrow Platform</p>
    </div>
    
    <div style="padding: 30px 0;">
        <h2 style="color: #1a1a2e;">Hello {full_name},</h2>
        
        <p style="color: #444; font-size: 16px; line-height: 1.6;">
            Welcome to Zuno! We need to verify your email address 
            to keep your account secure.
        </p>
        
        <div style="text-align: center; margin: 35px 0;">
            <a href="{verification_link}" 
               style="background-color: #4f46e5; 
                      color: white; 
                      padding: 14px 32px; 
                      text-decoration: none; 
                      border-radius: 6px; 
                      font-size: 16px;
                      font-weight: bold;">
                Verify My Email
            </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">
            Or copy and paste this link into your browser:
        </p>
        <p style="color: #4f46e5; font-size: 13px; word-break: break-all;">
            {verification_link}
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="color: #999; font-size: 13px;">
            ⏰ This link expires in <strong>24 hours</strong>.<br>
            🔒 If you did not create a Zuno account, ignore this email.<br>
            ❓ Need help? Contact us at support@zuno.co.ke
        </p>
    </div>
    
    <div style="background-color: #f5f5f5; padding: 15px; 
                border-radius: 8px; text-align: center;">
        <p style="color: #999; font-size: 12px; margin: 0;">
            © 2026 Zuno. Secure escrow for social commerce in Kenya.
        </p>
    </div>
    
</body>
</html>
    """
    if os.getenv('BREVO_API_KEY'):
        return _send_via_brevo(email, full_name, subject, html_body, text_body)

    if not os.getenv('MAIL_USERNAME') or not os.getenv('MAIL_PASSWORD'):
        print(f"[EMAIL DEV - not sent] Verification link for {email}: {verification_link}")
        return True

    try:
        msg = Message(
            subject=subject,
            recipients=[email],
            body=text_body,
            html=html_body,
        )
        
        app = current_app._get_current_object()
        def _send_async(app_obj, message):
            with app_obj.app_context():
                try:
                    mail.send(message)
                    print(f"[EMAIL] Verification email sent to {email}")
                except Exception as exc:
                    print(f"[EMAIL ERROR] Failed to send to {email}: {str(exc)}")
        threading.Thread(target=_send_async, args=(app, msg), daemon=True).start()
        return True
        
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {email}: {str(e)}")
        return False


def send_welcome_email(email, full_name):
    """
    Sends a welcome email after successful email verification.
    Simple confirmation that their account is fully set up.
    """
    if not os.getenv('MAIL_USERNAME') or not os.getenv('MAIL_PASSWORD'):
        print(f"[EMAIL DEV - not sent] Welcome email for {email}")
        return True
    try:
        msg = Message(
            subject="Welcome to Zuno — Your account is ready!",
            recipients=[email]
        )
        
        msg.body = f"""
Hello {full_name},

Your email has been verified and your Zuno account is fully active.

You can now:
- Create escrow deals and share payment links
- Build your seller reputation
- Access all Zuno features

Log in at: {os.getenv('FRONTEND_URL', 'http://localhost:3000')}

The Zuno Team
        """
        
        msg.html = f"""
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; 
             margin: 0 auto; padding: 20px;">
    
    <div style="background-color: #1a1a2e; padding: 20px; 
                border-radius: 8px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0;">ZUNO</h1>
    </div>
    
    <div style="padding: 30px 0; text-align: center;">
        <div style="font-size: 60px;">🎉</div>
        <h2 style="color: #1a1a2e;">You are all set, {full_name}!</h2>
        <p style="color: #444; font-size: 16px;">
            Your Zuno account is fully verified and ready to use.
        </p>
        
        <a href="{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/login"
           style="background-color: #4f46e5; color: white;
                  padding: 14px 32px; text-decoration: none;
                  border-radius: 6px; font-size: 16px; font-weight: bold;">
            Go to My Dashboard
        </a>
    </div>
    
</body>
</html>
        """
        
        app = current_app._get_current_object()
        def _send_welcome_async(app_obj, message):
            with app_obj.app_context():
                try:
                    mail.send(message)
                except Exception as exc:
                    print(f"[EMAIL ERROR] Welcome email failed for {email}: {str(exc)}")
        threading.Thread(target=_send_welcome_async, args=(app, msg), daemon=True).start()
        return True
        
    except Exception as e:
        print(f"[EMAIL ERROR] Welcome email failed for {email}: {str(e)}")
        return False