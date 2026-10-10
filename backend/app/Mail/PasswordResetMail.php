<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class PasswordResetMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public string $email, public string $token)
    {
    }

    public function build(): self
    {
        // The local Mailpit service makes the reset link inspectable without exposing an SMTP provider or secrets.
        return $this->subject('Reset your FLTS password')
            ->view('emails.password-reset', [
                'resetUrl' => rtrim((string) env('FRONTEND_URL', 'http://localhost:8080'), '/')
                    .'/reset-password?email='.urlencode($this->email).'&token='.urlencode($this->token),
            ]);
    }
}
