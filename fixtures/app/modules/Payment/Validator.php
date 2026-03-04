<?php
class Payment_Validator {
    public function validateCart($items) {
        // BUG: doesn't handle null $items
        foreach ($items as $item) {
            if ($item['price'] <= 0) {
                throw new Exception('Invalid price');
            }
        }
        return true;
    }
}
