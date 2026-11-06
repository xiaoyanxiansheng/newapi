package billingexpr

import (
	"errors"
	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/parser"
	"github.com/shopspring/decimal"
	"math"
	"strings"
)

// ScalePrices changes monetary coefficients, never tier thresholds or request
// factors. The result is a complete selling contract without procurement data.
// Unrecognized monetary shapes fail closed instead of approximating prices.
func ScalePrices(expression, multiplier string) (string, error) {
	if len(expression) == 0 || len(expression) > 16384 {
		return "", errors.New("dynamic pricing requires a complete supported billing expression")
	}
	factor, err := decimal.NewFromString(multiplier)
	if err != nil || !factor.IsPositive() || factor.GreaterThan(decimal.NewFromInt(1000000)) {
		return "", errors.New("invalid dynamic price multiplier")
	}
	if _, err := CompileFromCache(expression); err != nil {
		return "", err
	}
	_, body := ParseExprVersion(expression)
	tree, err := parser.Parse(body)
	if err != nil {
		return "", err
	}
	scaled, err := scalePriceNode(tree.Node, factor)
	if err != nil {
		return "", err
	}
	result := scaled.String()
	if strings.HasPrefix(expression, "v1:") {
		result = "v1:" + result
	}
	if _, err := CompileFromCache(result); err != nil {
		return "", err
	}
	return result, nil
}

func isPriceVariable(node ast.Node) bool {
	id, ok := node.(*ast.IdentifierNode)
	if !ok {
		return false
	}
	switch id.Value {
	case "p", "c", "cr", "cc", "cc1h", "img", "img_o", "ai", "ao":
		return true
	}
	return false
}
func containsPrice(node ast.Node) bool {
	return ast.Find(node, func(n ast.Node) bool {
		if isPriceVariable(n) {
			return true
		}
		call, ok := n.(*ast.CallNode)
		if !ok {
			return false
		}
		id, ok := call.Callee.(*ast.IdentifierNode)
		return ok && id.Value == "tier"
	}) != nil
}
func scalePriceNode(node ast.Node, factor decimal.Decimal) (ast.Node, error) {
	unsupported := errors.New("dynamic pricing contains an unsupported monetary rule; verify its full contract before publishing")
	switch n := node.(type) {
	case *ast.IntegerNode, *ast.FloatNode:
		amount, err := decimal.NewFromString(node.String())
		if err != nil || amount.IsNegative() {
			return nil, unsupported
		}
		value, _ := amount.Mul(factor).Float64()
		if math.IsInf(value, 0) || math.IsNaN(value) {
			return nil, unsupported
		}
		return &ast.FloatNode{Value: value}, nil
	case *ast.IdentifierNode:
		if !isPriceVariable(n) {
			return nil, unsupported
		}
		value, _ := factor.Float64()
		return &ast.BinaryNode{Operator: "*", Left: n, Right: &ast.FloatNode{Value: value}}, nil
	case *ast.ConditionalNode:
		var err error
		n.Exp1, err = scalePriceNode(n.Exp1, factor)
		if err != nil {
			return nil, err
		}
		n.Exp2, err = scalePriceNode(n.Exp2, factor)
		return n, err
	case *ast.CallNode:
		id, ok := n.Callee.(*ast.IdentifierNode)
		if !ok || id.Value != "tier" || len(n.Arguments) != 2 {
			return nil, unsupported
		}
		var err error
		n.Arguments[1], err = scalePriceNode(n.Arguments[1], factor)
		return n, err
	case *ast.BinaryNode:
		var err error
		switch n.Operator {
		case "+", "-":
			n.Left, err = scalePriceNode(n.Left, factor)
			if err != nil {
				return nil, err
			}
			n.Right, err = scalePriceNode(n.Right, factor)
			return n, err
		case "*":
			// Preserve dimensionless conditions outside a priced branch, but fold a
			// literal coefficient next to a token variable into its final price.
			if isPriceVariable(n.Left) {
				if _, ok := requestRuleNumber(n.Right); ok {
					n.Right, err = scalePriceNode(n.Right, factor)
					return n, err
				}
			}
			if isPriceVariable(n.Right) {
				if _, ok := requestRuleNumber(n.Left); ok {
					n.Left, err = scalePriceNode(n.Left, factor)
					return n, err
				}
			}
			left, right := containsPrice(n.Left), containsPrice(n.Right)
			if left == right {
				return nil, unsupported
			}
			if left {
				n.Left, err = scalePriceNode(n.Left, factor)
			} else {
				n.Right, err = scalePriceNode(n.Right, factor)
			}
			return n, err
		case "/":
			if containsPrice(n.Right) {
				return nil, unsupported
			}
			n.Left, err = scalePriceNode(n.Left, factor)
			return n, err
		}
	}
	return nil, unsupported
}
