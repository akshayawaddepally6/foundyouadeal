"""
Test and evaluate the fine-tuned Llama 3.1 model on product pricing predictions.

This script loads a fine-tuned model and evaluates its performance on a test set,
generating metrics and visualizations.
"""

import math
import torch
import torch.nn.functional as F
import matplotlib.pyplot as plt
from tqdm import tqdm
from huggingface_hub import login
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
from datasets import load_dataset
from peft import PeftModel

from config import *


# ANSI color codes for terminal output
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"

COLOR_MAP = {
    "red": RED,
    "orange": YELLOW,
    "green": GREEN
}


def setup_authentication(hf_token):
    """Authenticate with HuggingFace."""
    print("🔑 Authenticating with HuggingFace...")
    login(token=hf_token, add_to_git_credential=True)


def load_test_data():
    """Load the test dataset."""
    print(f"📊 Loading dataset: {DATASET_NAME}")
    dataset = load_dataset(DATASET_NAME)
    test_data = dataset["test"]
    print(f"✓ Test samples: {len(test_data):,}")
    return test_data


def setup_quantization():
    """Configure quantization for model loading."""
    if QUANT_4_BIT:
        print("⚙️  Configuring 4-bit quantization...")
        quant_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
    else:
        print("⚙️  Configuring 8-bit quantization...")
        quant_config = BitsAndBytesConfig(
            load_in_8bit=True,
            bnb_8bit_compute_dtype=torch.bfloat16,
        )
    return quant_config


def load_finetuned_model(model_name, revision=None):
    """Load the fine-tuned model with LoRA adapters."""
    print(f"🦙 Loading base model: {BASE_MODEL}")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # Load base model with quantization
    quant_config = setup_quantization()
    base_model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=quant_config,
        device_map="auto"
    )
    base_model.generation_config.pad_token_id = tokenizer.pad_token_id

    # Load LoRA adapters
    print(f"🔧 Loading fine-tuned adapters: {model_name}")
    adapter_kwargs = {} if revision is None else {"revision": revision}
    fine_tuned_model = PeftModel.from_pretrained(
        base_model,
        model_name,
        **adapter_kwargs
    )

    memory_mb = fine_tuned_model.get_memory_footprint() / 1e6
    print(f"✓ Model loaded: {memory_mb:.1f} MB")

    return fine_tuned_model, tokenizer


def predict_price(model, tokenizer, prompt_text, device="cuda"):
    """
    Predict price using top-K token probability weighting.

    Args:
        model: The fine-tuned model
        tokenizer: The tokenizer
        prompt_text: Product description prompt
        device: Device to run on

    Returns:
        float: Predicted price
    """
    set_seed(42)

    # Tokenize input
    encoded = tokenizer(prompt_text, return_tensors="pt")
    input_ids = encoded["input_ids"].to(device)
    attention_mask = encoded["attention_mask"].to(device)

    # Get model predictions
    with torch.no_grad():
        outputs = model(
            input_ids=input_ids,
            attention_mask=attention_mask
        )
        next_token_logits = outputs.logits[:, -1, :].cpu()

    # Convert to probabilities
    next_token_probs = F.softmax(next_token_logits, dim=-1)

    # Get top-K tokens
    top_probs, top_token_ids = next_token_probs.topk(TOP_K, dim=-1)

    prices = []
    weights = []

    for i in range(TOP_K):
        token_str = tokenizer.decode(top_token_ids[0, i])
        prob = top_probs[0, i]

        try:
            value = float(token_str)
        except ValueError:
            value = 0.0

        if value > 0:
            prices.append(value)
            weights.append(prob)

    if not prices:
        return 0.0

    # Weighted average
    total_weight = sum(weights)
    weighted_values = [p * (w / total_weight) for p, w in zip(prices, weights)]

    return sum(weighted_values).item()


class ModelEvaluator:
    """Evaluate model performance on test data."""

    def __init__(self, model, tokenizer, test_data, num_samples=TEST_SAMPLES):
        self.model = model
        self.tokenizer = tokenizer
        self.test_data = test_data
        self.num_samples = min(num_samples, len(test_data))

        # Tracking metrics
        self.predictions = []
        self.targets = []
        self.abs_errors = []
        self.squared_log_errors = []
        self.point_colors = []

    def _get_error_color(self, error, true_price):
        """Determine color based on error magnitude."""
        if error < 40 or error / true_price < 0.2:
            return "green"  # Good prediction
        elif error < 80 or error / true_price < 0.4:
            return "orange"  # Fair prediction
        return "red"  # Poor prediction

    def evaluate_sample(self, idx):
        """Evaluate a single sample."""
        item = self.test_data[idx]
        text = item["text"]
        true_price = item["price"]

        # Get prediction
        pred_price = predict_price(self.model, self.tokenizer, text)

        # Calculate metrics
        error = abs(pred_price - true_price)
        log_error = math.log(true_price + 1) - math.log(pred_price + 1)
        squared_log_error = log_error ** 2

        # Determine color
        color = self._get_error_color(error, true_price)

        # Extract short title
        lines = text.split("\n\n")
        short_title = lines[1][:30] + "..." if len(lines) > 1 else "Product"

        # Store results
        self.predictions.append(pred_price)
        self.targets.append(true_price)
        self.abs_errors.append(error)
        self.squared_log_errors.append(squared_log_error)
        self.point_colors.append(color)

        # Print result
        print(
            f"{COLOR_MAP[color]}{idx+1:3d}: "
            f"Pred: ${pred_price:7,.2f} | "
            f"True: ${true_price:7,.2f} | "
            f"Error: ${error:6,.2f} | "
            f"SLE: {squared_log_error:5.2f} | "
            f"{short_title}{RESET}"
        )

    def run_evaluation(self):
        """Run evaluation on all samples."""
        print("\n" + "=" * 80)
        print(f"📊 Evaluating {self.num_samples} samples...")
        print("=" * 80)

        for idx in tqdm(range(self.num_samples), desc="Testing"):
            self.evaluate_sample(idx)

        self._print_summary()
        self._plot_results()

    def _print_summary(self):
        """Print evaluation summary."""
        mean_abs_error = sum(self.abs_errors) / self.num_samples
        rmsle = math.sqrt(sum(self.squared_log_errors) / self.num_samples)

        num_green = sum(1 for c in self.point_colors if c == "green")
        num_orange = sum(1 for c in self.point_colors if c == "orange")
        num_red = sum(1 for c in self.point_colors if c == "red")

        hit_rate = num_green / self.num_samples * 100.0

        print("\n" + "=" * 80)
        print("📈 EVALUATION RESULTS")
        print("=" * 80)
        print(f"Mean Absolute Error: ${mean_abs_error:,.2f}")
        print(f"Root Mean Squared Log Error: {rmsle:.4f}")
        print(f"\nPrediction Quality:")
        print(f"  {GREEN}✓ Good (< 20% error):   {num_green:3d} ({num_green/self.num_samples*100:.1f}%){RESET}")
        print(f"  {YELLOW}~ Fair (20-40% error): {num_orange:3d} ({num_orange/self.num_samples*100:.1f}%){RESET}")
        print(f"  {RED}✗ Poor (> 40% error):  {num_red:3d} ({num_red/self.num_samples*100:.1f}%){RESET}")
        print(f"\nOverall Hit Rate: {hit_rate:.1f}%")
        print("=" * 80)

    def _plot_results(self):
        """Generate scatter plot of predictions vs ground truth."""
        max_truth = max(self.targets)
        max_pred = max(self.predictions)
        max_val = max(max_truth, max_pred)

        plt.figure(figsize=(12, 8))

        # Perfect prediction line
        plt.plot([0, max_val], [0, max_val], 'b--', lw=2, alpha=0.6, label="Perfect Prediction")

        # Scatter plot
        for color in ["green", "orange", "red"]:
            indices = [i for i, c in enumerate(self.point_colors) if c == color]
            if indices:
                plt.scatter(
                    [self.targets[i] for i in indices],
                    [self.predictions[i] for i in indices],
                    c=color,
                    s=10,
                    alpha=0.6,
                    label=color.capitalize()
                )

        plt.xlabel("Ground Truth Price ($)", fontsize=12)
        plt.ylabel("Predicted Price ($)", fontsize=12)
        plt.xlim(0, max_val)
        plt.ylim(0, max_val)
        plt.title("Fine-tuned Llama 3.1: Price Predictions", fontsize=14, fontweight="bold")
        plt.legend()
        plt.grid(True, alpha=0.3)

        # Save plot
        plt.savefig("evaluation_results.png", dpi=300, bbox_inches="tight")
        print("\n✓ Plot saved as: evaluation_results.png")

        plt.show()


def main(hf_token, model_name, num_samples=TEST_SAMPLES):
    """Main evaluation function."""
    print("=" * 80)
    print("🧪 Testing Fine-Tuned Llama 3.1 Model")
    print("=" * 80)

    # Setup
    setup_authentication(hf_token)

    # Load data
    test_data = load_test_data()

    # Load model
    model, tokenizer = load_finetuned_model(model_name)

    # Run evaluation
    evaluator = ModelEvaluator(model, tokenizer, test_data, num_samples)
    evaluator.run_evaluation()

    print("\n✅ Evaluation Complete!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test fine-tuned Llama 3.1 model")
    parser.add_argument("--hf_token", required=True, help="HuggingFace API token")
    parser.add_argument("--model_name", required=True, help="HuggingFace model name (e.g., akshayawadd/dealytics-2025-11-16_21.47.54)")
    parser.add_argument("--num_samples", type=int, default=TEST_SAMPLES, help="Number of samples to test")

    args = parser.parse_args()

    main(args.hf_token, args.model_name, args.num_samples)
