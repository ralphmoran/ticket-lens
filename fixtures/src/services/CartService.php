<?php
namespace App\Services;

class CartService {
    public function getItems($userId) {
        return $this->repository->findByUser($userId);
    }

    public function isEmpty($userId) {
        return count($this->getItems($userId)) === 0;
    }
}
