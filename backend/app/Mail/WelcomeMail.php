<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class WelcomeMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public User $user)
    {
    }

    public function build(): self
    {
        return $this->subject('Chào mừng bạn đến với FLTS!')
            ->view('emails.welcome', [
                'user' => $this->user,
                'loginUrl' => rtrim((string) env('FRONTEND_URL', 'http://localhost:8080'), '/') . '/login',
            ]);
    }
}
