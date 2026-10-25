#include "matrix/cblas-wrappers.h"

#include <cmath>
#include <cstdio>
#include <limits>

template <typename Real>
bool check_triangular_inverse(const char *precision) {
  constexpr KaldiBlasInt kDimension = 2;
  constexpr int kPackedEntries = 3;
  constexpr int kToleranceInEpsilon = 32;
  constexpr KaldiBlasInt kSuccess = 0;
  KaldiBlasInt dimension = kDimension;
  KaldiBlasInt info = -1;
  Real packed[kPackedEntries] = {Real(2), Real(1), Real(4)};
  const Real expected[kPackedEntries] = {Real(0.5), Real(-0.125), Real(0.25)};

  kaldi::clapack_Xtptri(&dimension, packed, &info);
  if (info != kSuccess) {
    std::fprintf(stderr, "%s inverse returned info=%d\n", precision, info);
    return false;
  }
  const Real tolerance =
      std::numeric_limits<Real>::epsilon() * kToleranceInEpsilon;
  for (int entry = 0; entry < kPackedEntries; ++entry) {
    if (!std::isfinite(packed[entry]) ||
        std::abs(packed[entry] - expected[entry]) > tolerance) {
      std::fprintf(stderr, "%s inverse[%d]: expected %.17g, got %.17g\n",
                   precision, entry, static_cast<double>(expected[entry]),
                   static_cast<double>(packed[entry]));
      return false;
    }
  }
  std::printf("%s PACKED_TRIANGULAR_INVERSE_READY\n", precision);
  return true;
}

int main() {
  const bool float_ok = check_triangular_inverse<float>("float");
  const bool double_ok = check_triangular_inverse<double>("double");
  return float_ok && double_ok ? 0 : 1;
}
