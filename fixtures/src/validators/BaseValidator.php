<?php
namespace App\Validators;

abstract class BaseValidator {
    abstract public function validate($data);

    protected function assertNotEmpty($value, $field) {
        if (empty($value)) {
            throw new \InvalidArgumentException("$field cannot be empty");
        }
    }
}
