<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    use HasFactory;

    public const ROLES = ['admin', 'lecturer', 'student'];

    protected $fillable = ['name', 'email', 'password', 'role', 'account_status', 'api_token_hash'];

    protected $hidden = ['password', 'api_token_hash'];
}
